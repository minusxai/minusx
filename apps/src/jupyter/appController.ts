import { clone, findIndex, isArray } from "lodash";
import { AppController, AddActionMetadata } from "../base/appController";
import { JupyterNotebookState } from "./helpers/DOMToState";
import { BlankMessageContent, RPCs } from "web";

export class JupyterController extends AppController<JupyterNotebookState> {
  @AddActionMetadata({ needsConfirmation: false, exposedToModel: false })
  async insertCellBelow({ cell_index }: { cell_index: number }) {
    await this.uClick({ query: "select_cell", index: cell_index });
    await this.uClick({ query: "insert_cell_below" });
    return;
  }

  @AddActionMetadata({ needsConfirmation: false, exposedToModel: false })
  async insertCellAbove({ cell_index }: { cell_index: number }) {
    await this.uClick({ query: "select_cell", index: cell_index });
    await this.uClick({ query: "insert_cell_above" });
    return;
  }

  @AddActionMetadata({ needsConfirmation: false, exposedToModel: false })
  async setCellValue({
    cell_index,
    source,
  }: {
    cell_index: number;
    source: string | string[];
  }) {
    const value = isArray(source) ? source.join("\r") : source;
    await this.uDblClick({ query: "select_cell", index: cell_index });
    await this.scrollIntoView({ query: "select_cell", index: cell_index });
    await this.uSetValue({
      query: "select_cell_text",
      index: cell_index,
      value,
    });
    return;
  }

  @AddActionMetadata({ needsConfirmation: false, exposedToModel: true })
  async runCell({ cell_index }: { cell_index: number }) {
    cell_index = await this.cellIndexOrCurrentlySelected(cell_index);
    await this.uClick({ query: "select_cell", index: cell_index });
    await this.uClick({ query: "run_cell" });
    await this.waitForCellExecution({ index: cell_index });
    // select the cell again because after execution, jupyter selects the next cell
    await this.uClick({ query: "select_cell", index: cell_index });
    return;
  }

  @AddActionMetadata({ needsConfirmation: false, exposedToModel: false })
  async executeCell({ cell_index }: { cell_index: number }) {
    const actionContent: BlankMessageContent = {
      type: "BLANK",
    };
    await this.uClick({ query: "select_cell", index: cell_index });
    await this.uClick({ query: "run_cell" });
    await this.waitForCellExecution({ index: cell_index });
    const state = await this.app.getState();
    const cellOutput = state?.cells[cell_index].output || [];
    actionContent.content = JSON.stringify(cellOutput);
    console.log("Cell output is", actionContent);
    return actionContent;
  }

  @AddActionMetadata({ needsConfirmation: false, exposedToModel: false })
  async deleteCells({ cell_indexes }: { cell_indexes: number[] }) {
    const sortedIds = clone(cell_indexes);
    sortedIds.sort();
    sortedIds.reverse();
    for (const id of sortedIds) {
      // TODO: does the id change between delete calls? probably does.
      await this.uClick({ query: "select_cell", index: id });
      await this.uClick({ query: "delete_cell" });
    }
    return;
  }

  @AddActionMetadata({ needsConfirmation: false, exposedToModel: false })
  async insertSetValueExecuteCell({
    cell_index,
    source,
  }: {
    cell_index: number;
    source: string | string[];
  }) {
    await this.insertCellBelow({ cell_index });
    await this.setCellValue({ cell_index: cell_index + 1, source });
    await this.executeCell({ cell_index: cell_index + 1 });
    return;
  }

  @AddActionMetadata({ needsConfirmation: true, exposedToModel: true })
  async addCodeAndRun({
    cell_index,
    source,
  }: {
    cell_index: number;
    source: string | string[];
  }) {
    cell_index = await this.cellIndexOrCurrentlySelected(cell_index);
    await this.insertCellBelow({ cell_index });
    await this.setCellValue({ cell_index: cell_index + 1, source });
    const cellOutput = await this.executeCell({ cell_index: cell_index + 1 });
    await this.uClick({ query: "select_cell", index: cell_index + 1 });
    return cellOutput;
  }

  @AddActionMetadata({ needsConfirmation: false, exposedToModel: false })
  async setValueExecuteCell({
    cell_index,
    source,
  }: {
    cell_index: number;
    source: string | string[];
  }) {
    await this.setCellValue({ cell_index, source });
    const cellOutput = await this.executeCell({ cell_index });
    return cellOutput;
  }

  @AddActionMetadata({ needsConfirmation: true, exposedToModel: true })
  async replaceCodeAndRun({
    cell_index,
    source,
  }: {
    cell_index: number;
    source: string | string[];
  }) {
    cell_index = await this.cellIndexOrCurrentlySelected(cell_index);
    await this.setCellValue({ cell_index, source });
    const cellOutput = await this.executeCell({ cell_index });
    await this.uClick({ query: "select_cell", index: cell_index });
    return cellOutput;
  }

  @AddActionMetadata({ needsConfirmation: false, exposedToModel: false })
  async getCurrentlySelectedCell() {
    const querySelectorMap = await this.app.getQuerySelectorMap();
    const queryResponse = await RPCs.queryDOMSingle({
      selector: querySelectorMap.whole_cell,
    });
    const selectedCell = findIndex(queryResponse, (cell) =>
      cell.attrs.class.includes?.("jp-mod-selected")
    );
    return selectedCell;
  }

  @AddActionMetadata({ needsConfirmation: false, exposedToModel: false })
  async cellIndexOrCurrentlySelected(cell_index: number | undefined) {
    if (cell_index === undefined) {
      const selectedCell = await this.getCurrentlySelectedCell();
      cell_index = selectedCell;
    }
    return cell_index;
  }

  @AddActionMetadata({ needsConfirmation: false, exposedToModel: false })
  async waitForCellExecution({ index }) {
    while (true) {
      const state = await this.app.getState();
      const cell = state.cells[index];
      // check if cell.inputAreaPrompt has an asterisk (it can be anywhere in the string)
      if (!cell.isExecuting) {
        break;
      }
      await this.wait({ time: 100 });
    }
  }
}
