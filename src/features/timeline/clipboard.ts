/**
 * Keyframe clipboard: an in-memory copy (fast, always available) mirrored to the system
 * clipboard as `{ "__lottieEditor": "keyframes", … }` JSON so keys can travel between tabs.
 */
import { create } from 'zustand'
import type { KeyframeClipboard } from '@/lottie/timeline-ops'
import { copyText } from '@/lib/clipboard'

interface ClipboardState {
  clip: KeyframeClipboard | null
}

export const useKeyClipboard = create<ClipboardState>()(() => ({ clip: null }))

export function getKeyClipboard(): KeyframeClipboard | null {
  return useKeyClipboard.getState().clip
}

export function hasKeyClipboard(): boolean {
  const clip = getKeyClipboard()
  return !!clip && clip.tracks.length > 0
}

/** Stores keyframes in memory and on the system clipboard. Resolves false if the latter failed. */
export async function writeKeyClipboard(clip: KeyframeClipboard): Promise<boolean> {
  useKeyClipboard.setState({ clip })
  return copyText(JSON.stringify(clip))
}
