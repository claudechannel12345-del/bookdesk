import { Extension } from '@tiptap/core'

const BLOCKS = ['paragraph', 'heading', 'blockquote']

/** Stores Docs-like block spacing and indentation in the rich sidecar document. */
export const DocumentLayout = Extension.create({
  name: 'documentLayout',

  addGlobalAttributes() {
    return [
      {
        types: BLOCKS,
        attributes: {
          lineSpacing: {
            default: null,
            parseHTML: (element) => element.style.lineHeight || null,
            renderHTML: (attributes) =>
              attributes.lineSpacing ? { style: `line-height: ${attributes.lineSpacing}` } : {}
          },
          indent: {
            default: 0,
            parseHTML: (element) => Math.round((parseFloat(element.style.marginLeft) || 0) / 36),
            renderHTML: (attributes) =>
              attributes.indent ? { style: `margin-left: ${attributes.indent * 36}px` } : {}
          }
        }
      }
    ]
  }
})

/** TextStyle owns inline presentation attributes that Markdown cannot represent. */
export const FontSize = Extension.create({
  name: 'fontSize',

  addGlobalAttributes() {
    return [
      {
        types: ['textStyle'],
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element) => element.style.fontSize || null,
            renderHTML: (attributes) =>
              attributes.fontSize ? { style: `font-size: ${attributes.fontSize}` } : {}
          }
        }
      }
    ]
  }
})
