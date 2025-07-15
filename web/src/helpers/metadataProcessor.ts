/**
 * Cards Metadata Processing
 * 
 * This module handles uploading cards metadata to the backend
 * with hash-based caching to avoid redundant uploads.
 */

import axios from 'axios';
import { configs } from '../constants';
import { getOrigin } from './origin';
import { get } from 'lodash';
import { MetadataProcessingResult, setMetadataHash, setMetadataProcessingCache } from '../state/settings/reducer';
import { getState } from '../state/store';
import { dispatch } from '../state/dispatch';
import { getAllCards, getAllCardsLegacy, getDatabaseTablesAndModelsWithoutFields, getAllFields } from '../../../apps/src/metabase/helpers/metabaseAPIHelpers';
import { fetchDatabaseFields } from '../../../apps/src/metabase/helpers/metabaseAPI';
import { getSelectedDbId } from '../../../apps/src/metabase/helpers/metabaseStateAPI';

export interface MetadataItem {
  metadata_type: string;
  metadata_value: any;
  version: string;
  metadata_hash: string;
}

export interface MetadataRequest {
  origin: string;
  metadata_items: MetadataItem[];
}

/**
 * Uploads metadata items to the backend (simplified, immediate upload)
 * @param metadataItems Array of metadata items to upload
 * @returns The response from the server
 */
export async function processMetadata(metadataItems: MetadataItem[]): Promise<any> {
  const metadataRequest: MetadataRequest = {
    origin: getOrigin(),
    metadata_items: metadataItems
  };

  try {
    const profile_id = getState().auth.profile_id
    if (profile_id) {
      const response = await axios.post(
        `${configs.DEEPRESEARCH_BASE_URL}/metadata`, 
        metadataRequest, 
      );
      return response.data;
    }
  } catch (error) {
    console.warn('Failed to upload metadata items:', error);
    throw error;
  }
}

/**
 * Calculates metadata hash for caching purposes (simplified & faster)
 */
async function calculateMetadataHash(metadataType: string, metadataValue: any, version: string): Promise<string> {
  // Simplified hash calculation - just hash the stringified data
  const content = JSON.stringify({ metadataType, version, metadataValue });
  const data = new TextEncoder().encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);

  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

// Global map to track ongoing uploads by hash
const ongoingUploads = new Map<string, Promise<string>>();

// Global map to track ongoing metadata processing by dbId
const ongoingMetadataProcessing = new Map<number, Promise<MetadataProcessingResult>>();

/**
 * Generic function to upload any metadata type to the backend
 * @param metadataType The type of metadata (e.g., 'cards', 'dbSchema')
 * @param data The data to upload
 * @param metadataHash The calculated hash to send to server
 * @returns The hash returned from the server
 */
async function uploadMetadata(metadataType: string, data: any, metadataHash: string): Promise<string | undefined> {
  // Check if this hash is already being uploaded
  if (ongoingUploads.has(metadataHash)) {
    console.log(`[minusx] Upload already in progress for hash ${metadataHash}, waiting...`)
    return await ongoingUploads.get(metadataHash)!;
  }

  // Create and store the upload promise
  const uploadPromise = (async () => {
    const metadataItem: MetadataItem = {
      metadata_type: metadataType,
      metadata_value: { [metadataType]: data },
      version: '1.0',
      metadata_hash: metadataHash
    };

    try {
      const response = await processMetadata([metadataItem]);
      const hash = get(response, 'results[0].metadata_hash')
      return hash
    } catch (error) {
      console.warn(`Failed to upload ${metadataType} metadata:`, error);
      throw error;
    } finally {
      // Clean up the ongoing upload tracking
      ongoingUploads.delete(metadataHash);
    }
  })();

  // Store the promise in the map
  ongoingUploads.set(metadataHash, uploadPromise);

  return await uploadPromise;
}

async function processMetadataWithCaching(
  metadataType: string,
  dataFetcher: () => Promise<any>): Promise<string | undefined> {
  // Fetch the data
  const data = await dataFetcher()
  console.log('Retrieved data for metadata type', metadataType, data)

  // Calculate hash of current data
  const currentHash = await calculateMetadataHash(metadataType, { [metadataType]: data }, '1.0')

  // Get stored hashes from Redux
  const currentState = getState()
  const storedHashes = currentState.settings.metadataHashes

  // Only upload if hash doesn't exist in the Record
  if (!storedHashes[currentHash]) {
    try {
      console.log(`[minusx] ${metadataType} data changed, uploading to metadata endpoint`)
      const serverHash = await uploadMetadata(metadataType, data, currentHash)

      // Store the new hash in Redux
      if (!serverHash) {
        console.warn(`[minusx] No hash returned for ${metadataType} metadata upload`)
        return serverHash; // Return current hash even if upload failed
      }
      dispatch(setMetadataHash(serverHash))
      console.log(`[minusx] ${metadataType} metadata uploaded and hash updated`)
    } catch (error) {
      console.warn(`[minusx] Failed to upload ${metadataType} metadata:`, error)
      // Continue without failing the entire request
    }
  } else {
    console.log(`[minusx] ${metadataType} data unchanged, skipping metadata upload`)
  }

  // Return the hash
  return currentHash
}

export async function processAllMetadata() : Promise<MetadataProcessingResult> {
  console.log('[minusx] Starting coordinated metadata processing with parallel API calls...')
  
  // Step 1: Start all expensive API calls in parallel
  console.log('[minusx] Initiating parallel API calls...')
  const selectedDbId = await getSelectedDbId()
  
  if (!selectedDbId) {
    throw new Error('No database selected for metadata processing')
  }
  
  // Check if processing is already in progress for this database ID
  if (ongoingMetadataProcessing.has(selectedDbId)) {
    console.log(`[minusx] Metadata processing already in progress for database ${selectedDbId}, returning existing promise`)
    return await ongoingMetadataProcessing.get(selectedDbId)!
  }
  
  // Create and store the processing promise
  const processingPromise = (async () => {
    try {
      // Check cache for this database ID
      const currentState = getState()
      const cacheEntry = currentState.settings.metadataProcessingCache[selectedDbId]
      
      if (cacheEntry) {
        const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
        const isStale = Date.now() - cacheEntry.timestamp > SEVEN_DAYS_MS
        
        if (!isStale) {
          console.log(`[minusx] Using cached metadata for database ${selectedDbId}`)
          return cacheEntry.result
        } else {
          console.log(`[minusx] Cached metadata for database ${selectedDbId} is stale, clearing cache`)
          // Clear stale cache entry
          delete currentState.settings.metadataProcessingCache[selectedDbId]
        }
      }
      
      const [dbSchema, { cards, tables: referencedTables }, allFields] = await Promise.all([
        getDatabaseTablesAndModelsWithoutFields(),
        getAllCards(),
        fetchDatabaseFields({ db_id: selectedDbId })
      ])
      
      console.log('[minusx] All API calls completed. Processing data...')
      
      // Step 2: Create sets for efficient lookup of existing tables
      const existingTableNames = new Set<string>()
      
      // Add tables from dbSchema
      if (dbSchema.tables) {
        dbSchema.tables.forEach((table: any) => {
          const tableName = table.name
          const schemaName = table.schema || dbSchema.default_schema
          const fullName = schemaName ? `${schemaName}.${tableName}` : tableName
          
          existingTableNames.add(tableName)
          existingTableNames.add(fullName)
        })
      }
      
      // Add models from dbSchema
      if (dbSchema.models) {
        dbSchema.models.forEach((model: any) => {
          existingTableNames.add(model.name)
        })
      }
      
      console.log('[minusx] Found existing tables/models:', existingTableNames.size)
      
      // Step 3: Find intersection of referenced tables that actually exist
      const validReferencedTables = referencedTables.filter((table: any) => {
        const tableName = table.name
        const schemaName = table.schema
        const fullName = schemaName ? `${schemaName}.${tableName}` : tableName
        
        return existingTableNames.has(tableName) || existingTableNames.has(fullName)
      })
      
      console.log('[minusx] Valid referenced tables:', validReferencedTables.length, 'out of', referencedTables.length)
      
      // Step 4: Filter fields in-memory using table names
      const validTableNames = new Set(validReferencedTables.map((table: any) => {
        const schemaName = table.schema
        return schemaName ? `${schemaName}.${table.name}` : table.name
      }))
      
      console.log('[minusx] Filtering fields for', validTableNames.size, 'valid tables...')
      
      const filteredFields = allFields.filter((field: any) => {
        const tableName = get(field, 'table_name')
        const tableSchema = get(field, 'schema')
        const fullTableName = tableSchema ? `${tableSchema}.${tableName}` : tableName
        
        return validTableNames.has(tableName) || validTableNames.has(fullTableName)
      })
      
      console.log('[minusx] Fields after filtering:', filteredFields.length, 'out of', allFields.length)
      
      // Step 5: Process metadata for all three with filtered data
      console.log('[minusx] Processing metadata with filtered data...')
      
      const [cardsHash, dbSchemaHash, fieldsHash] = await Promise.all([
        processMetadataWithCaching('cards', async () => cards),
        processMetadataWithCaching('dbSchema', async () => dbSchema),
        processMetadataWithCaching('fields', async () => filteredFields)
      ])
      
      console.log('[minusx] Coordinated metadata processing complete')
      
      const result = {
        cardsHash,
        dbSchemaHash, 
        fieldsHash
      }
  
      // Cache the result for this database ID
      dispatch(setMetadataProcessingCache({ dbId: selectedDbId, result }))
      console.log(`[minusx] Cached metadata processing result for database ${selectedDbId}`)
      
      return result
    } finally {
      // Clean up the ongoing processing tracking
      ongoingMetadataProcessing.delete(selectedDbId)
    }
  })()
  
  // Store the promise in the map
  ongoingMetadataProcessing.set(selectedDbId, processingPromise)
  
  return await processingPromise
}

