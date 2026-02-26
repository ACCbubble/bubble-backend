import { Request, Response } from 'express';

import { signToken } from '../utils/jwt';
import { validateRequiredFields } from '../utils/validation';

export const signup = (req: Request, res: Response): void => {
  const missing = validateRequiredFields(req.body, ['email', 'password']);

  if (missing.length > 0) {
    res.status(400).json({ error: `Missing fields: ${missing.join(', ')}` });
    return;
  }

  // TODO: Persist user in DB.
  res.status(201).json({ message: 'User created (template response).' });
};

export const login = (req: Request, res: Response): void => {
  const missing = validateRequiredFields(req.body, ['email', 'password']);

  if (missing.length > 0) {
    res.status(400).json({ error: `Missing fields: ${missing.join(', ')}` });
    return;
  }

  const token = signToken({ sub: req.body.email });

  res.status(200).json({ token });
};
