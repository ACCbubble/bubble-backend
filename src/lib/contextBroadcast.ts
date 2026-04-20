import { EventEmitter } from 'events'

// Named events:
// contextBus.emit('context_updated', { eventId: number, userId: number })
// contextBus.emit('message_created', { eventId: number, message: { id, content, createdAt, sender: { id, name } } })
export const contextBus = new EventEmitter()
