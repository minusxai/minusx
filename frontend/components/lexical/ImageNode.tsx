'use client';

/**
 * ImageNode — a Lexical DecoratorNode that renders an inline image from a `src`
 * URL (plus optional alt text). Docs are stored as plain markdown, so images
 * round-trip through the standard `![alt](src)` syntax via the IMAGE transformer
 * in `markdown-transformers.ts`. The node stores only the URL + alt text; the
 * actual upload happens in the toolbar (see LexicalTextEditor) before insertion.
 */

import { DecoratorNode } from 'lexical';
import type {
  EditorConfig,
  LexicalNode,
  NodeKey,
  SerializedLexicalNode,
  Spread,
} from 'lexical';

export type SerializedImageNode = Spread<
  {
    src: string;
    altText: string;
  },
  SerializedLexicalNode
>;

export class ImageNode extends DecoratorNode<React.ReactElement> {
  __src: string;
  __altText: string;

  static getType(): string {
    return 'image';
  }

  static clone(node: ImageNode): ImageNode {
    return new ImageNode(node.__src, node.__altText, node.__key);
  }

  constructor(src: string, altText: string = '', key?: NodeKey) {
    super(key);
    this.__src = src;
    this.__altText = altText;
  }

  static importJSON(serializedNode: SerializedImageNode): ImageNode {
    return $createImageNode({
      src: serializedNode.src,
      altText: serializedNode.altText,
    });
  }

  exportJSON(): SerializedImageNode {
    return {
      ...super.exportJSON(),
      type: 'image',
      version: 1,
      src: this.__src,
      altText: this.__altText,
    };
  }

  getSrc(): string {
    return this.__src;
  }

  getAltText(): string {
    return this.__altText;
  }

  // The markdown image transformer places the node inside a paragraph (via
  // textNode.replace), so it lives in the inline flow like a link/mention.
  isInline(): boolean {
    return true;
  }

  // Decorator nodes render via decorate(); createDOM just provides the wrapper.
  createDOM(config: EditorConfig): HTMLElement {
    const span = document.createElement('span');
    const className = config.theme.image;
    if (className) span.className = className;
    return span;
  }

  updateDOM(): false {
    return false;
  }

  decorate(): React.ReactElement {
    return (
      <img
        src={this.__src}
        alt={this.__altText}
        style={{ maxWidth: '100%', height: 'auto', borderRadius: '6px', display: 'inline-block', verticalAlign: 'bottom' }}
        draggable={false}
      />
    );
  }
}

export function $createImageNode({ src, altText = '' }: { src: string; altText?: string }): ImageNode {
  return new ImageNode(src, altText);
}

export function $isImageNode(node: LexicalNode | null | undefined): node is ImageNode {
  return node instanceof ImageNode;
}
