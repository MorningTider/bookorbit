import { ref, shallowRef } from 'vue'
import { Socket } from 'socket.io-client'
import type { AuthorEnrichmentStatusEvent, AuthorPhotoUpdatedEvent } from '@bookorbit/types'
import { createAuthenticatedSocket } from '@/lib/socket'

const status = ref<AuthorEnrichmentStatusEvent>({
  queued: 0,
  processing: 0,
  rateLimited: 0,
  failed: 0,
  latestFailureAt: null,
  done: 0,
  total: 0,
  paused: false,
  sessionTotal: 0,
  sessionDone: 0,
  sessionFailed: 0,
  currentItemName: null,
})
const photoUpdate = shallowRef<AuthorPhotoUpdatedEvent | null>(null)
const socketConnected = ref(true)
let socket: Socket | null = null

function getSocket(): Socket {
  if (!socket) {
    socket = createAuthenticatedSocket('/authors-enrichment', {
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    })

    socket.on('author-enrichment:status', (data: AuthorEnrichmentStatusEvent) => {
      status.value = data
    })

    socket.on('author-enrichment:photo-updated', (event: AuthorPhotoUpdatedEvent) => {
      photoUpdate.value = event
    })

    socket.on('connect', () => {
      socketConnected.value = true
    })

    socket.on('disconnect', () => {
      socketConnected.value = false
    })
  }
  return socket
}

export function useAuthorEnrichmentStatus() {
  function subscribe() {
    getSocket()
  }

  return { status, photoUpdate, socketConnected, subscribe }
}

export function disconnectAuthorEnrichmentSocket() {
  if (socket) {
    socket.disconnect()
    socket = null
  }
  status.value = {
    queued: 0,
    processing: 0,
    rateLimited: 0,
    failed: 0,
    latestFailureAt: null,
    done: 0,
    total: 0,
    paused: false,
    sessionTotal: 0,
    sessionDone: 0,
    sessionFailed: 0,
    currentItemName: null,
  }
  photoUpdate.value = null
  socketConnected.value = true
}
