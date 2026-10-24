import 'dotenv/config';
import { createApp } from './app.js';

const PORT = process.env.PORT ?? 4000;
const app = await createApp();
app.listen(PORT, () => console.log(`api en http://localhost:${PORT}`));
