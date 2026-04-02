import { EventEmitter } from 'events'

export const contextBus = new EventEmitter()
// contextBus.emit('context_updated', { groupId: number, userId: number })
// contextBus.emit('message_created', { groupId: number, message: { id, content, createdAt, sender: { id, name } } })
