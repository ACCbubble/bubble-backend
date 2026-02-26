import { Router } from 'express';

import {
  createPoll,
  deletePoll,
  getPollById,
  listPolls,
  updatePoll,
} from '../controllers/pollsController';

const router = Router();

router.get('/', listPolls);
router.get('/:id', getPollById);
router.post('/', createPoll);
router.patch('/:id', updatePoll);
router.delete('/:id', deletePoll);

export default router;
