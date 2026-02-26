import { Request, Response } from 'express';

export const listMessages = (_req: Request, res: Response): void => {
  res.status(200).json({ data: [], message: 'List messages template endpoint.' });
};

export const getMessageById = (req: Request, res: Response): void => {
  res.status(200).json({ id: req.params.id, message: 'Get message template endpoint.' });
};

export const createMessage = (req: Request, res: Response): void => {
  res.status(201).json({ data: req.body, message: 'Create message template endpoint.' });
};

export const updateMessage = (req: Request, res: Response): void => {
  res
    .status(200)
    .json({ id: req.params.id, data: req.body, message: 'Update message template endpoint.' });
};

export const deleteMessage = (req: Request, res: Response): void => {
  res.status(204).send({ id: req.params.id, message: 'Delete message template endpoint.' });
};
