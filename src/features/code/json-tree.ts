/**
 * JSON paths ⇄ positions using the Lezer JSON syntax tree that CodeMirror maintains
 * incrementally. Unlike a plain scan, the tree survives syntax errors elsewhere in the text,
 * so revealing and the cursor breadcrumb keep working while the user is mid-edit.
 *
 * Tree shape (@lezer/json): JsonText > Object > Property(PropertyName ":" value) and
 * Array("[" value "," value "]"), values being Object, Array, String, Number, True, False, Null.
 */
import type { SyntaxNode, Tree } from '@lezer/common'
import type { NodePath } from '@/lottie/path'
import type { PathRange } from './json-scan'

/** Reads document text in [from, to). */
export type ReadText = (from: number, to: number) => string

const VALUE_NODES = new Set(['Object', 'Array', 'String', 'Number', 'True', 'False', 'Null'])

function isValue(node: SyntaxNode): boolean {
  return VALUE_NODES.has(node.name)
}

function propertyKey(prop: SyntaxNode, read: ReadText): string | null {
  const name = prop.getChild('PropertyName')
  if (!name) return null
  try {
    const key: unknown = JSON.parse(read(name.from, name.to))
    return typeof key === 'string' ? key : null
  } catch {
    return null
  }
}

/** The value node of a Property, if it has one. */
function propertyValue(prop: SyntaxNode): SyntaxNode | null {
  const last = prop.lastChild
  return last && isValue(last) ? last : null
}

/** The top-level value of the document. */
function rootValue(tree: Tree): SyntaxNode | null {
  const top = tree.topNode
  for (let child = top.firstChild; child; child = child.nextSibling)
    if (isValue(child)) return child
  return null
}

/**
 * Locates the value at `path`. Returns null when the path does not exist, or undefined when
 * the (partially parsed) tree ends before the answer is known — callers then fall back to a
 * text scan.
 */
export function pathRangeInTree(
  tree: Tree,
  docLength: number,
  read: ReadText,
  path: NodePath,
): PathRange | null | undefined {
  const complete = tree.length >= docLength
  let node = rootValue(tree)
  if (!node) return complete ? null : undefined
  let keyFrom: number | undefined
  for (const seg of path) {
    keyFrom = undefined
    // A container cut off by the end of the parsed region may hide the child we look for.
    const truncated = !complete && node.to >= tree.length
    let next: SyntaxNode | null = null
    if (typeof seg === 'string') {
      if (node.name !== 'Object') return complete ? null : truncated ? undefined : null
      for (let prop: SyntaxNode | null = node.firstChild; prop; prop = prop.nextSibling) {
        if (prop.name !== 'Property' || propertyKey(prop, read) !== seg) continue
        next = propertyValue(prop)
        keyFrom = prop.from
        break
      }
    } else {
      if (node.name !== 'Array') return complete ? null : truncated ? undefined : null
      let index = 0
      for (let child: SyntaxNode | null = node.firstChild; child; child = child.nextSibling) {
        if (!isValue(child)) continue
        if (index === seg) {
          next = child
          break
        }
        index++
      }
    }
    if (!next) return truncated ? undefined : null
    node = next
  }
  if (!complete && node.to >= tree.length) return undefined
  return { from: node.from, to: node.to, keyFrom }
}

/** Index of `child` among the value children of an Array node. */
function arrayIndex(array: SyntaxNode, child: SyntaxNode): number {
  let index = 0
  for (let c = array.firstChild; c; c = c.nextSibling) {
    if (c.from === child.from && c.to === child.to && c.name === child.name) return index
    if (isValue(c)) index++
  }
  return index
}

/**
 * JSON path of the innermost value (or property) at `pos`, e.g. a cursor on `"p"` inside a
 * layer transform gives ['layers', 0, 'ks', 'p'].
 */
export function pathAtPosition(tree: Tree, read: ReadText, pos: number): NodePath {
  let node: SyntaxNode | null = tree.resolveInner(pos, 1)
  // Right after a value and before punctuation (`60|,`), the value is what the cursor is on.
  if (
    node.name === 'JsonText' ||
    (node.from === pos && (node.name === ',' || node.name === ']' || node.name === '}'))
  ) {
    const before = tree.resolveInner(pos, -1)
    if (before.name !== 'JsonText' && before.to === pos) node = before
  }
  const path: (string | number)[] = []
  for (let n: SyntaxNode | null = node; n; n = n.parent) {
    const parent: SyntaxNode | null = n.parent
    if (!parent) break
    if (parent.name === 'Property') {
      // Anywhere inside `"key": value` (name, colon or value) addresses that member.
      const key = propertyKey(parent, read)
      if (key !== null) path.push(key)
      // Skip the Property node itself: its parent (the Object) is handled next iteration.
      n = parent
      continue
    }
    if (parent.name === 'Array' && isValue(n)) path.push(arrayIndex(parent, n))
  }
  return path.reverse()
}
