import { BlankMessageContent, SemanticFilter, DefaultMessageContent, TimeDimension, Order } from "web/types";
import { RPCs, configs } from "web";
import { AppController, Action } from "../base/appController";
import {
  MetabaseAppState,
  MetabaseAppStateDashboard,
  MetabaseAppStateSQLEditor,
  MetabaseSemanticQueryAppState,
  MetabaseAppStateType,
} from "./helpers/DOMToState";
import {
  getAndFormatOutputTable,
  getSqlErrorMessage,
  metabaseToCSV,
  waitForQueryExecution,
} from "./helpers/operations";
import {
  memoizedFetchTableData,
  searchTables,
} from "./helpers/getDatabaseSchema";
import { get, isEmpty, map, set, truncate } from "lodash";
import {
  DashboardMetabaseState,
  DashcardDetails,
} from "./helpers/dashboard/types";
import _ from "lodash";
import { 
  VisualizationType,
  primaryVisualizationTypes,
  Card,
  toLowerVisualizationType,
  ParameterValues,
  SearchApiResponse
 } from "./helpers/types";
import {
  getTemplateTags,
  getParameters,
  getVariablesAndUuidsInQuery
} from "./helpers/sqlQuery";
import axios from 'axios'
import { getSelectedDbId, getUserInfo } from "./helpers/getUserInfo";
import { runSQLQueryFromDashboard } from "./helpers/dashboard/runSqlQueryFromDashboard";

const SEMANTIC_QUERY_API = `${configs.SEMANTIC_BASE_URL}/query`

export class MetabaseController extends AppController<MetabaseAppState> {
  // 0. Exposed actions --------------------------------------------
  @Action({
    labelRunning: "Updating SQL query",
    labelDone: "Updated query",
    description: "Updates the SQL query in the Metabase SQL editor and executes it.",
    renderBody: ({ sql }: { sql: string }, appState: MetabaseAppStateSQLEditor) => {
      const sqlQuery = appState?.sqlQuery
      return {text: null, code: sql, oldCode: sqlQuery}
    }
  })
  async updateSQLQuery({ sql, executeImmediately = true, _type = "markdown" }: { sql: string, executeImmediately?: boolean, _type?: string }) {
    const actionContent: BlankMessageContent = {
      type: "BLANK",
    };
    const state = (await this.app.getState()) as MetabaseAppStateSQLEditor;
    const userApproved = await RPCs.getUserConfirmation({content: sql, contentTitle: "Update SQL query?", oldContent: state.sqlQuery});
    if (!userApproved) {
      throw new Error("Action (and subsequent plan) cancelled!");
    }
    if (state.sqlEditorState == "closed") {
      await this.toggleSQLEditor("open");
    }
    const currentCard = await RPCs.getMetabaseState("qb.card") as Card;
    const varsAndUuids = getVariablesAndUuidsInQuery(sql);
    const existingTemplateTags = currentCard.dataset_query.native['template-tags'];
    const existingParameters = currentCard.parameters;
    const templateTags = getTemplateTags(varsAndUuids, existingTemplateTags || {});
    const parameters = getParameters(varsAndUuids, existingParameters || []);
    currentCard.dataset_query.native['template-tags'] = templateTags;
    currentCard.parameters = parameters;
    currentCard.dataset_query.native.query = sql;
    await RPCs.dispatchMetabaseAction('metabase/qb/UPDATE_QUESTION', { card: currentCard });
    await RPCs.dispatchMetabaseAction('metabase/qb/UPDATE_URL');
    
    // await this.uDblClick({ query: "sql_query" });
    // await this.setValue({ query: "sql_query", value: sql });

    
    if (executeImmediately) {
      return await this._executeQLQueryInternal("SQL", _type);
    } else {
      actionContent.content = "OK";
      return actionContent;
    }
  }
  // for dashboard interface
  @Action({
    labelRunning: "Running SQL Query",
    labelDone: "Ran SQL query",
    description: "Runs an SQL Query against the database",
    renderBody: ({ sql }: { sql: string }, appState: MetabaseAppStateDashboard) => {
      return {text: null, code: sql}
    }
  })
  async runSQLQuery({ sql }: { sql: string}) {
    const actionContent: BlankMessageContent = {
      type: "BLANK",
    };
    const state = (await this.app.getState()) as MetabaseAppStateDashboard;
    const dbID = state?.selectedDatabaseInfo?.id as number
    if (!dbID) {
      actionContent.content = "No database selected";
      return actionContent;
    }
    const response = await runSQLQueryFromDashboard(sql, dbID);
    if (response.error) {
      actionContent.content = response.error;
    } else {
      const asMarkdown = metabaseToCSV(response.data);
      actionContent.content = asMarkdown;
    }
    return actionContent;
  }

  @Action({
    labelRunning: "Executing SQL Query",
    labelDone: "Executed SQL query",
    description: "Executes the SQL query in the Metabase SQL editor.",
    renderBody: () => {
      return {text: null, code: null}
    }
  })
  async executeSQLQuery() {
    const userApproved = await RPCs.getUserConfirmation({content: "Execute query", contentTitle: "Accept below action?", oldContent: undefined});
    if (!userApproved) {
      throw new Error("Action (and subsequent plan) cancelled!");
    }
    return await this._executeQLQueryInternal("SQL");
  }

  @Action({
    labelRunning: "Executes the SQL query",
    labelDone: "Executed query",
    description: "Executes the SQL query in the Metabase SQL editor.",
    renderBody: ({ sql }: { sql: string }, appState: MetabaseAppStateSQLEditor) => {
      const sqlQuery = appState?.sqlQuery
      return {text: null, code: sql, oldCode: sqlQuery, language: "sql"}
    }
  })
  async ExecuteSQLClient({ sql, _client_type }: { sql: string, _client_type?: string }) {
    if (_client_type === MetabaseAppStateType.SQLEditor) {
        return await this.updateSQLQuery({ sql, executeImmediately: true, _type: "csv" });
    }
    else if (_client_type === MetabaseAppStateType.Dashboard) {
        return await this.runSQLQuery({ sql });      
    }
  }

  @Action({
    labelRunning: "Constructs the MBQL query",
    labelDone: "MBQL built",
    description: "Constructs the MBQL query in the GUI editor",
    // renderBody: ({ mbql }: { mbql: any }) => {
    //   return {text: null, code: JSON.stringify(mbql), oldCode: null, language: "json"}
    // }
    renderBody: () => {
        return {}
    }
  })
//   async ExecuteMBQLClient({ mbql, _client_type }: { mbql: any, _client_type?: string }) {
  async ExecuteMBQLClient() {
    const dummyCard = {
        type: "question",
        visualization_settings: {},
        display: "scalar",
        dataset_query: {
            database: 2,
            type: "query",
            query: {
                "source-table": 65,
                aggregation: [
                    [
                        "count"
                    ]
                ]
            }
        }
    };
    await RPCs.dispatchMetabaseAction('metabase/qb/UPDATE_QUESTION', {card: dummyCard});
    // await RPCs.dispatchMetabaseAction('metabase/qb/UPDATE_URL');
    // await this._executeQLQueryInternal("MBQL");

    const actionContent: BlankMessageContent = {
        type: "BLANK",
    };
    actionContent.content = "OK";
    return actionContent;

  }

  @Action({
    labelRunning: "Updating SQL Variable",
    labelDone: "Updated SQL Variable",
    description: "Updates value or metadata of a variable in the SQL editor.",
    renderBody: ({ variable, value, type, displayName }: { variable: string, value: string, type: string, displayName: string}) => {
      return {text: `variable: ${variable}`, code: JSON.stringify({value, type, displayName})}
    }
  })
  async setSqlVariable({ variable, value, type, displayName }: { variable: string, value: string, type: string, displayName: string }) {
    const actionContent: BlankMessageContent = {
      type: "BLANK",
    };
    const setContentAndWarn = (content: string) => {
      actionContent.content = content;
      console.warn(content);
    }
    const currentCard = await RPCs.getMetabaseState("qb.card") as Card;
    if (currentCard) {
      let parameters = _.get(currentCard, 'dataset_query.native.template-tags', {} as any);
      if (parameters[variable] == undefined) {
        setContentAndWarn(`Could not update variable value: Variable "${variable}" not found`);
        return actionContent;
      } else {
        let parameterId = parameters[variable].id;
        if (parameterId == undefined) {
          setContentAndWarn(`Could not update variable value: Variable "${variable}" not found`);
          return actionContent;
        } else {
          // check if type and displayName are present and use the qb.card UPDATE_QUESTION action to update them
          let variableInfo = currentCard.dataset_query.native['template-tags']?.[variable];
          variableInfo['type'] = type ?? variableInfo['type'];
          variableInfo['display-name'] = displayName ?? variableInfo['display-name'];
          currentCard.dataset_query.native['template-tags'][variable] = variableInfo;
          const typeToOtherTypeMap = {
            'text': 'category',
            'number': 'number/=',
            'date': 'date/single',
            '': ''
          } as Record<string, string>;
          let otherType = typeToOtherTypeMap[variableInfo['type']];
          // find the parameter in currentCard.parameters and modify its type to otherType
          console.log("currentCard.parameters", currentCard.parameters);
          let currentParams = currentCard.parameters || [];
          for (let i = 0; i < currentParams.length; i++) {
            const parameter = currentParams[i];
            if (parameter.slug == variable) {
              parameter.type = otherType ?? parameter.type;
              parameter.name = displayName ?? parameter.name;
              break;
            }
          }

          await RPCs.dispatchMetabaseAction('metabase/qb/UPDATE_QUESTION', { card: currentCard });
          // check if value is present. if yes, then update.
          if (value != undefined) {
            await RPCs.dispatchMetabaseAction('metabase/qb/SET_PARAMETER_VALUE', { id: parameterId, value });
          }
          await RPCs.dispatchMetabaseAction('metabase/qb/SET_TEMPLATE_TAG')
        }
      }
    } else {
      setContentAndWarn("Could not update variable value: No current card found");
      return actionContent;
    }
    return actionContent;
  }

  @Action({
    labelRunning: "Plotting data",
    labelDone: "Plotted data",
    description: "Plots the data in the SQL editor using the given visualization type.",
    renderBody: ({ visualization_type, dimensions, metrics}: { visualization_type: VisualizationType, dimensions?: string[], metrics?: string[] }) => {
      return {text: `plot: ${visualization_type}`, code: JSON.stringify({dimensions, metrics})}
    }
  })
  async setVisualizationType({
    visualization_type,
    dimensions,
    metrics
  }: {
    visualization_type: VisualizationType,
    dimensions?: string[],
    metrics?: string[]
  }) {
    // vivek: ensure the visualization type is capital case
    function toCapitalCase(str: string) {
      return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
    }
    visualization_type = toCapitalCase(visualization_type);    
    console.log("Setting visualization type to", visualization_type, dimensions, metrics);
    if (primaryVisualizationTypes.includes(visualization_type) && (dimensions && metrics)) {
      const currentCard = await RPCs.getMetabaseState("qb.card") as Card;
      if (currentCard) {
        currentCard.display = toLowerVisualizationType(visualization_type);
        const visualization_settings = {
          "graph.dimensions": dimensions,
          "graph.metrics": metrics,
          "graph.series_order_dimension": null,
          "graph.series_order": null
        }
        currentCard.visualization_settings = visualization_settings;
      }
      try {
        await RPCs.dispatchMetabaseAction('metabase/qb/UPDATE_QUESTION', { card: currentCard });
        await RPCs.dispatchMetabaseAction('metabase/qb/UPDATE_URL');
        return
      }
      catch (error) {
        console.error("Failed to update visualization type, falling back to UI method", error);
      }
    }
    const state = (await this.app.getState()) as MetabaseAppStateSQLEditor;
    if (state.visualizationType === visualization_type.toLowerCase()) {
      return;
    }
    if (state.visualizationSettingsStatus == "closed") {
      await this.uClick({ query: "vizualization_button" });
    }

    const querySelectorMap = await this.app.getQuerySelectorMap();
    const query = `${visualization_type}_button`;
    await this.uClick({ query });
    await this.uClick({ query: "vizualization_button" });
    // @vivek: Check if the visualization is invalid. Need to actually solve the issue
    const vizInvalid = await RPCs.queryDOMSingle({
      selector: querySelectorMap["viz_invalid"],
    });
    if (vizInvalid.length > 0) {
      await this.uClick({ query: "switch_to_data" });
    }
    return;
  }

  @Action({
    labelRunning: "Retrieving table schemas",
    labelDone: "Analyzed tables",
    description: "Retrieves the schemas of the specified tables by their ids in the database.",
    renderBody: ({ids}: { ids: number[] }, _: any, result: BlankMessageContent) => {
      let content = []
      try {
        content = JSON.parse(result.content || "[]");
        content = content.map((table: any) => table.name)
      } catch (error) {
        content = []
      }
      const code = isEmpty(content) ? `No tables found for ids: ${ids.join(', ')}` : `Tables found for ids: ${content.join(', ')}`
      return {text: null, code, language: 'markdown'}
    }
  })
  async getTableSchemasById({ ids }: { ids: number[] }) {
    const actionContent: BlankMessageContent = { type: "BLANK" };
    // need to fetch schemas
    const tablesPromises = ids.map(memoizedFetchTableData);
    const tables = await Promise.all(tablesPromises);
    const tableSchemasContent = JSON.stringify(tables);
    actionContent.content = tableSchemasContent;
    return actionContent;
  }

  @Action({
    labelRunning: "Searching for tables",
    labelDone: "Found tables",
    description: "Searches for tables in the database based on the query.",
    renderBody: ({ query }: { query: string }, _: any, result: BlankMessageContent) => {
      let searchResults = []
      try {
        searchResults = JSON.parse(result.content || "[]")
      } catch (error) {
        searchResults = []
      }
      const results = searchResults.map((table: any) => table.name).join(', ')
      const code = isEmpty(results) ? `No tables found for '${query}'` : `Search results for '${query}': ${results}` 
      return {text: null, code, language: "markdown"}
    }
  })
  async searchTableSchemas({ query }: { query: string }) {
    const actionContent: BlankMessageContent = { type: "BLANK" };
    const selectedDbId = await getSelectedDbId();
    if (!selectedDbId) {
      actionContent.content = "No database selected";
      return actionContent;
    }
    const userInfo = await getUserInfo()
    if (isEmpty(userInfo)) {
      actionContent.content = "Failed to load user info";
      return actionContent;
    }
    const searchResults = await searchTables(userInfo.id, selectedDbId, query);
    const tableIds = map(searchResults, (table) => table.id);
    const tablesPromises = tableIds.slice(0, 20).map(memoizedFetchTableData);
    const tableSchemas = await Promise.all(tablesPromises);
    tableSchemas.forEach((tableInfo, index) => {
      if (tableInfo != "missing") {
        tableInfo.count = searchResults[index].count;
      }
    })
    actionContent.content = JSON.stringify(tableSchemas);
    return actionContent
  }

  @Action({
    labelRunning: "Searching for previous SQL queries",
    labelDone: "Retrieved queries",
    description: "Searches for previous SQL queries using the specified words.",
    renderBody: ({words}: { words: string[] }) => {
      return {text: null, code: JSON.stringify(words)}
    }
  })
  async searchPreviousSQLQueries({ words }: { words: string[] }) {
    const actionContent: BlankMessageContent = { type: "BLANK" };
    const selectedDbId = await getSelectedDbId();
    const endpoint = `/api/search?table_db_id=${selectedDbId}&search_native_query=true&models=card&models=dataset&q=${words.join(' ')}`;
    let queries: {
      name: string
      description?: string
      query: string
    }[] = []
    try {
      const response = await RPCs.fetchData(endpoint, 'GET') as SearchApiResponse;
      // need to get name, description, and query from each card and put into a json obj
      queries = (response.data || []).map((card: any) => {
        const query = get(card, 'dataset_query.native.query')
        const name = get(card, 'name')
        const description = get(card, 'description')
        return {
          name,
          // only keep description if it's not null
          ...(description != null && { description }),
          query
        }
      }).filter(i => !!i)
      // keep only the first 10 queries. TODO: pagination?
      .slice(0, 10);
    } catch (error) {
      queries = [];
    }
    // truncate to 5k chars and add a ...[truncated] if needed
    actionContent.content = JSON.stringify(queries, null, 2)
    if (actionContent.content.length > 5000) {
      actionContent.content = actionContent.content.slice(0, 5000) + '...[truncated]';
    }
    return actionContent
  }

  @Action({
    labelRunning: "Getting dashcard details",
    labelDone: "Retrieved dashcards",
    description: "Gets more detailed information about the specified dashcards, including the visualization type, the query, and the data displayed.",
    renderBody: ({ids}: { ids: number[] }) => {
      return {text: null, code: JSON.stringify(ids)}
    }
  })
  async getDashcardDetailsById({ ids }: { ids: number[] }) {
    let actionContent: BlankMessageContent = { type: "BLANK" };
    const dashboardMetabaseState: DashboardMetabaseState =
      await RPCs.getMetabaseState("dashboard") as DashboardMetabaseState;

    if (
      !dashboardMetabaseState ||
      !dashboardMetabaseState.dashboards ||
      !dashboardMetabaseState.dashboardId
    ) {
      actionContent.content = "Could not get dashboard info";
      return actionContent;
    }
    const { dashboardId, dashboards, dashcards, dashcardData } =
      dashboardMetabaseState;
    const { ordered_cards, dashcards: dashcardsList } =
      dashboards?.[dashboardId];
    const cardsList = ordered_cards ? ordered_cards : dashcardsList;
    let cardDetailsList: DashcardDetails[] = [];
    if (cardsList) {
      for (const cardId of ids) {
        const card = dashcards?.[cardId];
        // dashcardData[cardId] seems to always have one key, so just get the first one
        const cardData = Object.values(_.get(dashcardData, [cardId]))?.[0];
        if (card && cardData) {
          let cardDetails: DashcardDetails = {
            id: cardId,
            data: {
              rows: cardData?.data?.rows,
              cols: cardData?.data?.cols?.map((col) => col?.display_name),
            },
            description: card?.card?.description,
            visualizationType: card?.card?.display,
          };
          // remove descritiption if it's null or undefined
          if (!cardDetails.description) {
            delete cardDetails.description;
          }
          cardDetailsList.push(cardDetails);
        }
      }
      actionContent.content = truncate(JSON.stringify(cardDetailsList), {
        length: 5000,
      });
    } else if (cardsList == undefined || cardsList == null) {
      console.warn("No cards found for dashboard. Maybe wrong key?");
      actionContent.content = "No cards found for dashboard";
    }
    return actionContent;
  }
  
  @Action({
    labelRunning: "Selecting database",
    labelDone: "Selected database",
    description: "Selects the specified database.",
    renderBody: ({database}: { database: string }) => {
      return {text: null, code: JSON.stringify({database})}
    }
  })
  async selectDatabase({ database }: { database: string }) {
    let actionContent: BlankMessageContent = { type: "BLANK" };
    const state = (await this.app.getState()) as MetabaseAppStateSQLEditor;
    if (state.selectedDatabaseInfo?.name === database) {
      actionContent.content = "Database already selected";
      return actionContent;
    }
    const querySelectorMap = await this.app.getQuerySelectorMap();
    let options = await RPCs.queryDOMSingle({ selector: querySelectorMap["select_database_dropdown_options"], attrs: ['text'] });
    // if no options, need to click on dropdown selector first
    if (options.length === 0) {
      await this.uClick({ query: "select_database_dropdown" });
      options = await RPCs.queryDOMSingle({ selector: querySelectorMap["select_database_dropdown_options"], attrs: ['text'] });
    }
    const optionsTexts = options.map((option: any) => option?.attrs?.text); 
    // find the index of the database in the options
    const index = optionsTexts.findIndex((optionText: string) => optionText?.toLowerCase() === database?.toLowerCase());
    if (index === -1) {
      actionContent.content = `Database "${database}" not found`;
      return actionContent;
    }
    await this.uClick({ query: `select_database_dropdown_options`, index });
    actionContent.content = "Database selected";
    return actionContent;
  }

  @Action({
    labelRunning: "SQL from Semantic Layer",
    labelDone: "Semantic Query Retrieved",
    description: "Gets the SQL query from the semantic query.",
    renderBody: ({ reasoning, measures, dimensions, filters, timeDimensions, order }: { reasoning: string, measures: string[], dimensions: string[], filters: SemanticFilter[], timeDimensions: TimeDimension[], order: Order[] }) => {
      return {text: null, code: JSON.stringify({measures, dimensions, filters, reasoning, timeDimensions, order})}
    }
  })
  async getSemanticQuery({ reasoning, measures, dimensions, filters, timeDimensions, order }: { reasoning: string, measures: string[], dimensions: string[], filters: SemanticFilter[], timeDimensions: TimeDimension[], order: Order[] }) {
    const actionContent: DefaultMessageContent = {
      type: "DEFAULT",
      text: reasoning,
      images: [],
    };
    const semanticQuery = {
      measures,
      dimensions,
      filters,
      timeDimensions,
      order
    }
    RPCs.applySemanticQuery(semanticQuery);
    await this.applySemanticQuery();
    return actionContent;
  }

  // 1. Internal actions -------------------------------------------
  async toggleSQLEditor(mode: "open" | "close") {
    if (mode === "open") {
      await this.uDblClick({ query: "expand_editor" });
    } else if (mode === "close") {
      await this.uDblClick({ query: "contract_editor" });
    }
    return;
  }
  async _executeQLQueryInternal(queryType: "SQL" | "MBQL", _type = "markdown") {
    const actionContent: BlankMessageContent = {
      type: "BLANK",
    };
    if (queryType === "SQL") {
        await this.uClick({ query: "run_query" });
    } else if (queryType === "MBQL") {
        await this.uClick({ query: "mbql_visualize" });
    }
    await waitForQueryExecution();
    const sqlErrorMessage = await getSqlErrorMessage();
    if (sqlErrorMessage) {
      actionContent.content = sqlErrorMessage;
    } else {
      // table output
      let tableOutput = ""
      tableOutput = await getAndFormatOutputTable(_type);
      actionContent.content = tableOutput;
    }
    return actionContent;
  }
  async applySemanticQuery() {
    const state = (await this.app.getState()) as MetabaseSemanticQueryAppState;
    const fetchData = async () => {
      if ((state.currentSemanticQuery.measures.length === 0) && (state.currentSemanticQuery.dimensions.length === 0)) {
        return "";
      }
      const payload = {
        ...state.currentSemanticQuery,
        dialect: state.dialect,
        layer: state.currentSemanticLayer,
      }
      const response = await axios.post(SEMANTIC_QUERY_API, payload, {
        headers: {
          'Content-Type': 'application/json',
        },
      })
      const data = await response.data
      const query = data.query
      return query
    }
    try{
      const query = await fetchData();
      return await this.updateSQLQuery({ sql: query, executeImmediately: true });
    }
    catch(error){
      console.error("Failed to get query from semantic layer", error)
      return;
    }
    
  }

  // 2. Deprecated or unused actions -------------------------------
  async getOutputAsImage(){
    const img = await RPCs.getElementScreenCapture({selector: "//*[@data-testid='query-visualization-root']", type: "XPATH"});
    return img;
  }

  async getOutputAsText(){
    return;
  }

}
