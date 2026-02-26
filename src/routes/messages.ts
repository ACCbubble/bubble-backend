import { Router } from 'express';

import {
  createMessage,
  deleteMessage,
  getMessageById,
  listMessages,
  updateMessage,
} from '../controllers/messagesController';

const router = Router();

router.get('/', listMessages);
router.get('/:id', getMessageById);
router.post('/', createMessage);
router.patch('/:id', updateMessage);
router.delete('/:id', deleteMessage);

export default router;
