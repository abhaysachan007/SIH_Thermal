import axios from 'axios';

const API = axios.create({ baseURL: 'http://localhost:8000' });

export const getMaterials = () => API.get('/api/materials').then(r => r.data);
export const getClimateProfiles = () => API.get('/api/climate-profiles').then(r => r.data);

export const submitSimulation = (shelterInput) =>
  API.post('/api/simulate', shelterInput).then(r => r.data);

export const pollResult = (jobId) =>
  API.get(`/api/results/${jobId}`).then(r => r.data);

export const submitCompare = (variants) =>
  API.post('/api/compare', { variants }).then(r => r.data);

export const pollCompareResult = (jobId) =>
  API.get(`/api/compare/${jobId}`).then(r => r.data);

// Poll until status == 'complete' or 'failed', with 2s interval, max 120s timeout
export const pollUntilDone = async (jobId, isCompare = false, onProgress = null) => {
  const maxAttempts = 60;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const result = isCompare ? await pollCompareResult(jobId) : await pollResult(jobId);
    if (onProgress) onProgress(result);
    if (result.status === 'complete' || result.status === 'failed') return result;
  }
  throw new Error('Simulation timed out after 2 minutes.');
};

export const runOptimizer = (shelterInput) =>
  API.post('/api/optimize', shelterInput).then(r => r.data);

