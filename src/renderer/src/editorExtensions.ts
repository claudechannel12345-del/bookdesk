import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export interface FindRange {
  from: number
  to: number
}

/** Inline decorations for Find — highlights every match, strong style on the active one. */
export const FindHighlight = Extension.create({
  name: 'findHighlight',

  addStorage() {
    return { ranges: [] as FindRange[], active: -1 }
  },

  addProseMirrorPlugins() {
    const storage = this.storage
    return [
      new Plugin({
        key: new PluginKey('findHighlight'),
        props: {
          decorations(state) {
            if (!storage.ranges.length) return null
            return DecorationSet.create(
              state.doc,
              storage.ranges.map((r: FindRange, i: number) =>
                Decoration.inline(r.from, r.to, {
                  class: i === storage.active ? 'find-hit find-hit-active' : 'find-hit'
                })
              )
            )
          }
        }
      })
    ]
  }
})

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
