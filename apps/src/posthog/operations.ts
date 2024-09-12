import { RPCs } from "web"; 
import { querySelectorMap, outputTableQuery } from "./querySelectorMap";
import { sleep } from "../common/utils";
export const waitForQueryExecution = async () => {
 // TODO
 while(true) {
  let isExecuting = await RPCs.queryDOMSingle({
      selector: querySelectorMap["cancel_button"],
    });
    if (isExecuting.length == 0) {
      break;
    }
    await sleep(100);
  }
}

export const getSqlErrorMessageFromDOM = async () => {
  let errorMessage = await RPCs.queryDOMSingle({
    selector: querySelectorMap["sql_error_message"],
  });
  return (errorMessage as any)?.[0]?.attrs?.text;
}

interface OutputTableQueryResponseFirstElement {
  children: {
    headers?: {
      children: {
        cells?: {
          attrs: {
            text: string
          }
        }[]
      }
    }[]
    rows?: {
      children: {
        cells?: {
          attrs: {
            text: string
          }
        }[]
      }
    }[]
  }
}

function convertToMarkdown(table: OutputTableQueryResponseFirstElement): string {
  let markdown = '';
  // Check if headers are present and not empty
  if (table.children.headers && table.children.headers.length > 0) {
    const headerRow = table.children.headers[0].children.cells?.map(cell => cell.attrs.text) || [];
    if (headerRow.length > 0) {
      markdown += `| ${headerRow.join(' | ')} |\n`;
      markdown += `| ${headerRow.map(() => '---').join(' | ')} |\n`;
    }
  }
  // Convert rows to markdown if present
  if (table.children.rows) {
    table.children.rows.forEach(row => {
      const rowText = row.children.cells?.map(cell => cell.attrs.text) || [];
      markdown += `| ${rowText.join(' | ')} |\n`;
    });
  }
  return markdown;
}


export const getAndFormatOutputTable = async () => {
  // TODO
  let outputTable = await RPCs.queryDOMSingle(outputTableQuery);
  let outputTableMarkdown = ""
  if (outputTable && outputTable.length > 0) {
    outputTableMarkdown = convertToMarkdown(outputTable[0] as OutputTableQueryResponseFirstElement);
  }
  // truncate if more than 2k characters. add an ...[truncated]
  if (outputTableMarkdown.length > 1000) {
    outputTableMarkdown = outputTableMarkdown.slice(0, 2000) + '...[truncated]';
  }
  return outputTableMarkdown;
}

export const getSqlQuery = async () => {
  let sqlQuery = await RPCs.queryDOMSingle({
    selector: querySelectorMap["sql_read"],
  });
  return sqlQuery?.map((row) => row?.attrs?.text).join('\n');
}

export const waitForRunButtonOrError = async () => {
  // wait 500 ms
  await sleep(500);
  const isDisabled = await RPCs.queryDOMSingle({
    selector: querySelectorMap["disabled_run_button"],
  });
  if (isDisabled.length == 0) {
    return; // no error
  }
  // TODO: get error, either using hover or pressing f8 key
  return "Syntax Error";
  // await RPCs.uClick(querySelectorMap["sql_query"]);
  // await RPCs.typeText(querySelectorMap["sql_query"], sql)
  // while (true) {
  //   const isDisabled = await RPCs.queryDOMSingle({
  //     selector: querySelectorMap["disabled_run_button"],
  //   });
  //   if (isDisabled.length == 0) {
  //     return;
  //   }
  //   await sleep(100);
  // }
}