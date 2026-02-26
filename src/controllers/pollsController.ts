import { Request, Response } from 'express';

export const listPolls = (_req: Request, res: Response): void => {
  res.status(200).json({ data: [], message: 'List polls template endpoint.' });
};

export const getPollById = (req: Request, res: Response): void => {
  res.status(200).json({ id: req.params.id, message: 'Get poll template endpoint.' });
};

export const createPoll = (req: Request, res: Response): void => {
  res.status(201).json({ data: req.body, message: 'Create poll template endpoint.' });
};

export const updatePoll = (req: Request, res: Response): void => {
  res
    .status(200)
    .json({ id: req.params.id, data: req.body, message: 'Update poll template endpoint.' });
};

export const deletePoll = (req: Request, res: Response): void => {
  res.status(204).send({ id: req.params.id, message: 'Delete poll template endpoint.' });
};
