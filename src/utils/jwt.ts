import jwt from 'jsonwebtoken';

const DEFAULT_SECRET = 'change_me';
const DEFAULT_EXPIRATION = '1h';

export interface TokenPayload {
  sub: string;
}

export const signToken = (payload: TokenPayload): string => {
  const secret = process.env.JWT_SECRET || DEFAULT_SECRET;
  return jwt.sign(payload, secret, { expiresIn: DEFAULT_EXPIRATION });
};
