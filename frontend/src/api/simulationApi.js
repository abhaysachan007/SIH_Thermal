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

// Poll until status == 'complete' or 'failed'.
// ANSYS FEA (launching MAPDL + meshing + 24 transient solves) can legitimately
// take several minutes, far longer than the Python FDM path — so the caller
// must pass a timeout that matches the selected engine (see pollTimeoutMsFor).
export const pollUntilDone = async (jobId, isCompare = false, onProgress = null, timeoutMs = 120000) => {
  const intervalMs = 3000;
  const maxAttempts = Math.ceil(timeoutMs / intervalMs);
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, intervalMs));
    const result = isCompare ? await pollCompareResult(jobId) : await pollResult(jobId);
    if (onProgress) onProgress(result, i, maxAttempts);
    if (result.status === 'complete' || result.status === 'failed') return result;
  }
  throw new Error(
    `Simulation is still running after ${Math.round(timeoutMs / 60000)} minutes. ` +
    `It has not failed — check the backend terminal for progress, then reload ` +
    `the results page for this job once it finishes.`
  );
};

// ANSYS launches a full MAPDL process, meshes the 3D model, and solves 24
// transient timesteps — budget generously. FDM finishes in seconds.
export const pollTimeoutMsFor = (engine) => (engine === 'ansys' ? 15 * 60 * 1000 : 2 * 60 * 1000);

export const runOptimizer = (shelterInput) =>
  API.post('/api/optimize', shelterInput).then(r => r.data);

