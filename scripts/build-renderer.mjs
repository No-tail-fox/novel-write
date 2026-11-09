// Set native worker limits before Vite loads the Rolldown binding. Each CLI run
// gets its own limits; the launcher and the user's global environment stay intact.
process.env.ROLLDOWN_WORKER_THREADS ||= '2';
process.env.RAYON_NUM_THREADS ||= '2';

const { build } = await import('vite');
await build();
