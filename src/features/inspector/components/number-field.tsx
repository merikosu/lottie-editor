/**
 * Number fields for document values. The shared field never commits unless the user actually
 * edited the text (Tab-through, Escape and a playhead that moved while focused write nothing),
 * so the inspector uses it directly.
 */
export { NumberField } from '@/components/ui'
