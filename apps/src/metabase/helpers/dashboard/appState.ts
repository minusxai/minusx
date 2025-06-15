import { DashboardInfo, DashboardMetabaseState } from './types';
import _, { forEach, reduce, template, values } from 'lodash';
import { MetabaseAppStateDashboard,  MetabaseAppStateType} from '../DOMToState';
import { getTablesWithFields } from '../getDatabaseSchema';
import { getDatabaseInfo, getFieldResolvedName } from '../metabaseAPIHelpers';
import { getDashboardState, getSelectedDbId } from '../metabaseStateAPI';
import { RPCs } from 'web';
import { metabaseToMarkdownTable } from '../operations';
import { find, get } from 'lodash';
import { getTablesFromSqlRegex, TableAndSchema } from '../parseSql';
import { getTableContextYAML } from '../catalog';

// Removed: const { getMetabaseState } = RPCs - using centralized state functions instead

function getSelectedTabDashcardIds(dashboardMetabaseState: DashboardMetabaseState) {
  const currentDashboardData = dashboardMetabaseState.dashboards?.[dashboardMetabaseState.dashboardId];
  if (!currentDashboardData) {
    return [];
  }
  const { ordered_cards, dashcards: dashcardsList } = currentDashboardData;
  const cardsList = ordered_cards ? ordered_cards : dashcardsList;
  if (!cardsList) {
    console.warn('No cards found in dashboard');
    return [];
  }
  const selectedTabId = getSelectedTabId(dashboardMetabaseState);
  // if selectedTabId is null, then there are no tabs so return all cards
  if (!selectedTabId) 
    return cardsList;
  const { tabs } = currentDashboardData;
  if (!tabs) {
    console.warn('No tabs found in dashboard but selectedTabId is not null');
    return cardsList;
  }
  const tabIds = tabs.map(tab => tab.id);
  if (!tabIds.includes(selectedTabId)) {
    console.warn('selectedTabId is not in tabs');
    return cardsList;
  }
  const dashcards = dashboardMetabaseState.dashcards;
  const selectedTabDashcardIds = Object.values(dashcards)
    .filter(dashcard => dashcard.dashboard_tab_id === selectedTabId)
    .map(dashcard => _.get(dashcard, 'id'));
  return selectedTabDashcardIds;
}

function getDashcardInfoByIds(ids: number[], dashboardMetabaseState: DashboardMetabaseState) {
  const { dashcards } = dashboardMetabaseState;
  const dashcardsInfo = Object.values(dashcards).filter(dashcard => ids.includes(dashcard?.id));
  return dashcardsInfo;
}

function getSelectedTabId(dashboardMetabaseState: DashboardMetabaseState) {
  const { dashboardId } = dashboardMetabaseState;
  const selectedTabId = _.get(dashboardMetabaseState, ['selectedTabId'], null)
  // sometimes selectedTabId is null because no tab is explicitly selected, so
  // need to select the first tab. other times its null because its an older metabase
  // version without tabs
  const tabs = _.get(dashboardMetabaseState, ['dashboards', dashboardId, 'tabs'], []);
  if (!selectedTabId && tabs.length > 0) {
    return tabs[0].id;
  }
  return selectedTabId;
}

export type DashboardInfoForModelling = {
  id: number,
  name: string | undefined,
  description?: string | undefined,
  parameters: {
    name: string,
    id: string,
    type: string,
    value?: string | null
  }[];
  cards: {
    id: number,
    name: string,
    sql: string,
    databaseId: number,
    description?: string | undefined,
    outputTableMarkdown?: string,
  }[]
}

function substituteParameterMappings(
  sql: string, 
  dashboardParameters: DashboardMetabaseState['dashboards'][0]['parameters'],
  parameterMappings: DashboardMetabaseState['dashcards'][0]['parameter_mappings']) {
  // treat both 'variable' and 'dimension' types the same for now.
  for (const parameterMapping of parameterMappings) {
    const parameterName = parameterMapping.target[1][1]
    const parameterId = parameterMapping.parameter_id
    const toReplaceBy = dashboardParameters.find(parameter => parameter.id === parameterId)?.slug
    if (toReplaceBy) {
      sql = sql.replace(new RegExp(`{{\\s*${parameterName}\\s*}}`, 'g'), `{{${toReplaceBy}}}`)
    }
  }
  return sql
}

async function getDashcardInfoWithSQLAndOutputTableMd(
  dashboardMetabaseState: DashboardMetabaseState, 
  dashcardId: number,
  dashboardId: number): Promise<DashboardInfoForModelling['cards'][number] | null> {
  const dashcard = dashboardMetabaseState.dashcards[dashcardId];
  if (!dashcard) {
    return null;
  }
  const cardId = _.get(dashcard, 'card_id', '');
  const databaseId = _.get(dashcard, 'card.database_id', 0);
  const id = _.get(dashcard, 'id');
  const query_type = _.get(dashcard, 'card.query_type', 'unknown');
  let sql = _.get(dashcard, 'card.dataset_query.native.query', '');
  const name = _.get(dashcard, 'card.name', '');
  const description = _.get(dashcard, 'card.description', '');
  const visualizationType = _.get(dashcard, 'card.display', '');
  if (!name)
    return null;
  // TODO(@arpit): only supporting native cards for now
  if (!sql || query_type != 'native')
    return null;

  // replace parameters
  sql = await substituteParameters(sql, dashcard, dashboardMetabaseState['dashboards'][dashboardId]?.param_fields, dashboardMetabaseState.parameterValues)
  const obj = {
    id,
    name,
    sql,
    databaseId,
    visualizationType,
    ...(description ? { description } : {}),
  }
  // dashcardData
  const data = _.get(dashboardMetabaseState, ['dashcardData', dashcardId, cardId, 'data']);
  if (!data) {
    return obj
  }
  const dataAsMarkdown = metabaseToMarkdownTable(data, 1000);
  return {
   ...obj,
   outputTableMarkdown: dataAsMarkdown
  }
}
/* 
The same dashboard parameter can be used as a variable or a field filter in a card, based on the card's parameter_mapping.
This is kind of confusing and hard to model; so simplifying right now by checking if the parameter is used in even a single card as 
a field filter, in which case it's a field filter. 
a field filter is a parameter_mapping of type 'dimension'
*/
// function checkIfParameterIsFieldFilter(parameterId: string, dashboardMetabaseState: DashboardMetabaseState, dashboardId: number) {
//   const dashcards = _.get(dashboardMetabaseState, ['dashcards'], [])
//   const parameterMappings = Object.values(dashcards).flatMap(dashcard => dashcard.parameter_mappings)
//     .filter(paramMapping => paramMapping.parameter_id === parameterId)
//   return _.some(parameterMappings, paramMapping => paramMapping.target[0] === 'dimension')
// }

// function getDashboardParameters(dashboardMetabaseState: DashboardMetabaseState, dashboardId: number) {
//   const parameters = _.get(dashboardMetabaseState, ['dashboards', dashboardId, 'parameters'], [])
//   return parameters.map(param => {
//     const id = _.get(param, 'id')
//     return ({
//       display_name: _.get(param, 'name'),
//       name: _.get(param, 'slug'),
//       id: _.get(param, 'id'),
//       type: _.get(param, 'type'),
//       value: _.get(dashboardMetabaseState, ['parameterValues', param.id], param.default),
//       isFieldFilter: checkIfParameterIsFieldFilter(param.id, dashboardMetabaseState, dashboardId)
//     })
//   } )
// }

function stringifyParams(params: any) {
  return '(' + JSON.stringify(params).slice(1, -1).replaceAll('"', "'") + ')'
}

async function substituteParameters(
  sql: string, 
  dashcard: DashboardMetabaseState['dashcards'][0],
  dashboardParamFields: DashboardMetabaseState['dashboards'][0]['param_fields'],
  parameterValues: DashboardMetabaseState['parameterValues']) {
  // Algo:
  // transitivity is: template-tags -> dashcard parameters -> dashcard parameter mappings -> dashboard parameters -> parameter values
  //                                        |-> parameter values
  // for each template-tag, find out if it is connected tot he dashboard using the parameter mappings.
  // if so, use the parameter value from the dashboard. otherwise use dashcard parameter default value.
  // when replacing, check if the template-tag is of type 'dimension'. if so, consider it a field filter and replace accordingly.
  // otherwise simply substitute as a variable

  const templateTags = Object.values(_.get(dashcard, ['card', 'dataset_query', 'native', 'template-tags'], {}))
  const dashcardParameters = _.get(dashcard, ['card', 'parameters'], [])
  // parameters is an array
  for (let i = 0; i < templateTags.length; i++) {
    const templateTag = templateTags[i];
    const dashcardParameter = dashcardParameters.find(parameter => parameter.id == templateTag.id)
    if (templateTag.type == 'snippet') {
      // TODO(@arpit): handle snippets
      continue
    }
    if (!dashcardParameter) {
      throw new Error(`Parameter ${templateTag.name} not found in card ${dashcard.id}`)
    }
    const parameterMapping = dashcard.parameter_mappings.find(mapping => mapping.target[1][1] === templateTag.name)
    const parameterValue = parameterValues?.[parameterMapping?.parameter_id || ''] || dashcardParameter?.default || ''
    // for now assume its always connected to a dashboard parameter
    // only some parameter types are supported
    if (templateTag.type == 'dimension' && templateTag.dimension?.[0] == 'field') {
      // only supporting string/= right now
      if (dashcardParameter.type != 'string/=') {
        throw new Error(`Parameter type ${dashcardParameter.type} is not supported in field filters. template tag: ${templateTag.name}`);
      }
      const fieldName = await getFieldResolvedName(templateTag.dimension[1])
      sql = sql.replace(new RegExp(`{{\\s*${dashcardParameter.slug}\\s*}}`, 'g'), `${fieldName} in ${stringifyParams(parameterValue)}`);
    } else if (templateTag.type == 'text') {
      sql = sql.replace(new RegExp(`{{\\s*${dashcardParameter.slug}\\s*}}`, 'g'), `'${parameterValue}'`);
    } else if (templateTag.type == 'date') {
      sql = sql.replace(new RegExp(`{{\\s*${dashcardParameter.slug}\\s*}}`, 'g'), `Date('${parameterValue}')`);
    } else {
      throw new Error(`Parameter type ${dashcardParameter?.type} is not supported. template tag: ${templateTag.name}`);
    }
  }
  return sql;
};

export async function getDashboardAppState(): Promise<MetabaseAppStateDashboard | null> {
  const url = new URL(await RPCs.queryURL()).origin;
  const appSettings = RPCs.getAppSettings();
  const selectedCatalog = get(find(appSettings.availableCatalogs, { name: appSettings.selectedCatalog }), 'content')
  const dbId = await getSelectedDbId();
  const selectedDatabaseInfo = dbId ? await getDatabaseInfo(dbId) : undefined
  const defaultSchema = selectedDatabaseInfo?.default_schema; 
      
  const dashboardMetabaseState: DashboardMetabaseState = await getDashboardState() as DashboardMetabaseState;
  if (!dashboardMetabaseState || !dashboardMetabaseState.dashboards || !dashboardMetabaseState.dashboardId) {
    console.warn('Could not get dashboard info');
    return null;
  }
  const { dashboardId } = dashboardMetabaseState;
  let dashboardInfo: DashboardInfo = {
    id: dashboardId,
    name: _.get(dashboardMetabaseState, ['dashboards', dashboardId, 'name']),
    description: _.get(dashboardMetabaseState, ['dashboards', dashboardId, 'description']),
    selectedTabId: getSelectedTabId(dashboardMetabaseState),
    tabs: _.get(dashboardMetabaseState, ['dashboards', dashboardId, 'tabs'], []).map(tab => ({
      id: _.get(tab, 'id'),
      name: _.get(tab, 'name')
    })),
    cards: [],
  }
  const selectedTabDashcardIds = getSelectedTabDashcardIds(dashboardMetabaseState);
//   const dashboardParameters = _.get(dashboardMetabaseState, ['dashboards', dashboardId, 'parameters'], [])
  const cards = await Promise.all(selectedTabDashcardIds.map(async dashcardId => await getDashcardInfoWithSQLAndOutputTableMd(dashboardMetabaseState, dashcardId, dashboardId)))
  const filteredCards = _.compact(cards);
  let sqlTables: TableAndSchema[] = []
  forEach(filteredCards, (card) => {
    if (card) {
      getTablesFromSqlRegex(card.sql).forEach((table) => {
        if (defaultSchema) {
          if (table.schema === undefined || table.schema === '') {
            table.schema = defaultSchema
          }
        }
        sqlTables.push(table)
      })
    }
  })
  sqlTables = _.uniqBy(sqlTables, (table) => `${table.schema}::${table.name}`)
  const relevantTablesWithFields = await getTablesWithFields(appSettings.tableDiff, appSettings.drMode, !!selectedCatalog, sqlTables, [])
  const tableContextYAML = getTableContextYAML(relevantTablesWithFields, selectedCatalog, appSettings.drMode);
  dashboardInfo.cards = filteredCards
  // filter out dashcards with null names or ids
  .filter(dashcard => dashcard.name !== null && dashcard.id !== null);
  // remove description if it's null or undefined
  if (!dashboardInfo.description) {
    delete dashboardInfo.description;
  }
  return { 
    ...dashboardInfo,
    type: MetabaseAppStateType.Dashboard,
    tableContextYAML,
    selectedDatabaseInfo,
    metabaseOrigin: url,
};
}


// export async function getDashboardInfoForModelling(): Promise<DashboardInfoForModelling | undefined> {
//   const dashboardMetabaseState: DashboardMetabaseState = await getDashboardState() as DashboardMetabaseState;
//   if (!dashboardMetabaseState || !dashboardMetabaseState.dashboards || !dashboardMetabaseState.dashboardId) {
//     console.warn('Could not get dashboard info');
//     return undefined;
//   }
//   const { dashboardId } = dashboardMetabaseState;
//   const name = _.get(dashboardMetabaseState, ['dashboards', dashboardId, 'name']);
//   const selectedTabDashcardIds = getSelectedTabDashcardIds(dashboardMetabaseState);
//   const dashboardParameters = _.get(dashboardMetabaseState, ['dashboards', dashboardId, 'parameters'], [])
//   const cards = selectedTabDashcardIds.map(dashcardId => getDashcardInfoWithSQLAndOutputTableMd(dashboardMetabaseState, dashcardId, dashboardParameters))
//   const filteredCards = _.compact(cards);
//   const parameters = _.get(dashboardMetabaseState, ['dashboards', dashboardId, 'parameters'], []).map(param => ({
//     display_name: _.get(param, 'name'),
//     name: _.get(param, 'slug'),
//     id: _.get(param, 'id'),
//     type: _.get(param, 'type'),
//     value: _.get(dashboardMetabaseState, ['parameterValues', param.id], param.default)
//   }))
//   console.log("<><><><><>< cards", cards)
//   return {
//     id: dashboardId,
//     name,
//     cards: filteredCards,
//     parameters
//   }
// }