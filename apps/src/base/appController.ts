import type { QuerySelector, QuerySelectorMap, Base64Image } from "extension/types";
import { get } from "lodash";
import { DefaultMessageContent, RPCs, utils } from "web";
import 'reflect-metadata';

interface App<T> {
  getState: () => Promise<T>;
  getQuerySelectorMap: () => Promise<QuerySelectorMap>;
}

export interface ActionMetadata {
  needsConfirmation: boolean;
  exposedToModel: boolean;
}

export function AddActionMetadata(metadata: ActionMetadata) {
  return function (
    target: any,
    propertyKey: string,
    descriptor?: PropertyDescriptor
  ) {
    Reflect.defineMetadata(propertyKey, metadata, target);
  };
}

export function getActionMetadata(target: any, propertyKey: string) {
  return Reflect.getMetadata(propertyKey, target);
}

export abstract class AppController<T> {
  protected app: App<T>;

  constructor(app: App<T>) {
    this.app = app;
  }

  async markTaskDone({ taskDone }: { taskDone: boolean }) {
    return;
  }

  respondToUser({ content }: { content: string }) {
    const actionContent: DefaultMessageContent = {
      type: "DEFAULT",
      text: content,
      images: [],
    };
    return actionContent;
  }

  talkToUser({ content }: { content: string }) {
    return this.respondToUser({ content });
  }

  async wait({ time }: { time: number }) {
    await utils.sleep(time);
  }

  async uClick({ query, index = 0 }) {
    const selectorMap = await this.app.getQuerySelectorMap();
    const selector = selectorMap[query];
    return await RPCs.uClick(selector, index);
  }

  async uDblClick({ query, index = 0 }) {
    const selectorMap = await this.app.getQuerySelectorMap();
    const selector = selectorMap[query];
    return await RPCs.uDblClick(selector, index);
  }

  async scrollIntoView({ query, index = 0 }) {
    const selectorMap = await this.app.getQuerySelectorMap();
    const selector = selectorMap[query];
    return await RPCs.scrollIntoView(selector, index);
  }

  async uSetValue({ query, value = "", index = 0 }) {
    const selectorMap = await this.app.getQuerySelectorMap();
    const selector = selectorMap[query];
    await getRippleEffect(selector, index);
    await this.uDblClick({ query, index });
    await RPCs.uSetValue(selector, value, index, "fast");
  }

  async uHighlight(
    selector: QuerySelector,
    index: number = 0,
    styles?: Partial<HTMLEmbedElement["style"]>
  ) {
    await RPCs.uHighlight(selector, index, styles);
  }

  async runAction(fn: string, args: any) {
    console.log("Action metadata", getActionMetadata(this, fn));
    // @ts-ignore: Check if controller has function and execute!
    return await this[fn](args);
  }
}

const getRippleEffect = async (selector, index) => {
  const queryResponse = await RPCs.queryDOMSingle({ selector });
  const coords = get(queryResponse, `[${index}].coords`);
  if (coords) {
    const { x, y } = coords;
    const rippleTime = 500;
    const numRipples = 2;
    RPCs.ripple(x, y, rippleTime, {
      "background-color": "rgba(22, 160, 133, 1.0)",
      animation: `web-agent-ripple ${
        rippleTime / (1000 * numRipples)
      }s infinite`,
    });
  }
};
