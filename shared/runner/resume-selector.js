/**
 * shared/runner/resume-selector.js
 * Intelligently determines which PDF resume to attach based on job title & JD.
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const RESUMES_DIR = path.join(__dirname, '..', '..', 'resumes');
const CONFIG_FILE = path.join(RESUMES_DIR, 'config.json');

function loadResumeConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch (_) {}

  return {
    defaultResume: 'fullstack.pdf',
    profiles: [],
  };
}

/**
 * getBestResume — selects the optimal PDF resume path for a job.
 *
 * @param {object} job
 * @param {string} [job.title]
 * @param {string} [job.jd]
 * @returns {{ path: string, filename: string, label: string, id: string }}
 */
function getBestResume(job = {}) {
  const config = loadResumeConfig();
  const text = `${job.title || ''} ${job.jd || ''}`.toLowerCase();

  let bestProfile = null;
  let highestScore = 0;

  for (const profile of config.profiles || []) {
    let score = 0;
    const titleLower = (job.title || '').toLowerCase();

    for (const kw of profile.keywords || []) {
      const kwLower = kw.toLowerCase();
      // Match in title gives higher weight (3x)
      if (titleLower.includes(kwLower)) {
        score += 3;
      } else if (text.includes(kwLower)) {
        score += 1;
      }
    }

    if (score > highestScore) {
      highestScore = score;
      bestProfile = profile;
    }
  }

  const chosenFilename = bestProfile ? bestProfile.file : config.defaultResume;
  const targetPath = path.join(RESUMES_DIR, chosenFilename);

  // Fallback to any existing pdf in resumes/ if chosen doesn't exist
  let finalPath = targetPath;
  if (!fs.existsSync(finalPath)) {
    const existingPdfs = fs.readdirSync(RESUMES_DIR).filter((f) => f.endsWith('.pdf'));
    if (existingPdfs.length > 0) {
      finalPath = path.join(RESUMES_DIR, existingPdfs[0]);
    }
  }

  return {
    path:     finalPath,
    filename: path.basename(finalPath),
    label:    bestProfile ? bestProfile.label : 'Default Resume',
    id:       bestProfile ? bestProfile.id : 'default',
    score:    highestScore,
  };
}

module.exports = {
  getBestResume,
  loadResumeConfig,
  RESUMES_DIR,
  CONFIG_FILE,
};
