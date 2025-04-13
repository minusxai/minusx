import React, { useState } from "react"
import { Text, Link, HStack, VStack, Button, Box } from "@chakra-ui/react";
import { useSelector } from 'react-redux';
import { RootState } from '../../state/store';
import { CodeBlock } from './CodeBlock';
import { CatalogEditor } from './CatalogEditor';
import { BiPencil } from "react-icons/bi";

export const YAMLCatalog: React.FC<null> = () => {
  const [isEditing, setIsEditing] = useState(false);
  const availableCatalogs = useSelector((state: RootState) => state.settings.availableCatalogs);
  const selectedCatalog = useSelector((state: RootState) => state.settings.selectedCatalog);
  const dbName = useSelector((state: RootState) => state.settings.selectedDbName);
  
  const currentCatalog = availableCatalogs.find(catalog => catalog.value === selectedCatalog);
  const yamlContent = currentCatalog?.content || '';

  const handleEditClick = () => {
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
  };
  
  return (
    <VStack w="100%" align="stretch" spacing={4}>
      <HStack w={"100%"} justify={"space-between"}>
        <Text fontSize="md" fontWeight="bold">Catalog: {currentCatalog?.name || 'None selected'}</Text>
        {!isEditing && (
          <Button 
            size="xs" 
            colorScheme="minusxGreen" 
            onClick={handleEditClick}
            leftIcon={<BiPencil />}
          >
            Edit
          </Button>
        )}
      </HStack>
      
      {isEditing ? (
        <CatalogEditor 
          onCancel={handleCancelEdit} 
          dbName={dbName} 
          defaultTitle={currentCatalog?.name || ''}
          defaultContent={yamlContent}
        />
      ) : (
        <Box w="100%">
            <CodeBlock 
              code={yamlContent} 
              tool="" 
              language="yaml" 
            />
          </Box>
      )}
    </VStack>
  );
}
