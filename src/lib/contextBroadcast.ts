import { EventEmitter } from 'events'

export const contextBus = new EventEmitter()
// contextBus.emit('context_updated', { eventId: number, userId: number })
// contextBus.emit('message_created', { eventId: number, message: { id, content, createdAt, sender: { id, name } } })
