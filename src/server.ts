import dotenv from 'dotenv';
import express from 'express';

import authRoutes from './routes/auth';
import messageRoutes from './routes/messages';
import pollRoutes from './routes/polls';

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(express.json());

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.use('/auth', authRoutes);
app.use('/messages', messageRoutes);
app.use('/polls', pollRoutes);

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Bubble backend listening on port ${port}`);
});
