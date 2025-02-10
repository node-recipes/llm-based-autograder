import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

import * as core from '@actions/core';
import { GoogleGenerativeAI } from '@google/generative-ai';

function getFullFilePath(file_path: string): string {
  if (!process.env.GITHUB_WORKSPACE) throw new Error('GITHUB_WORKSPACE is not set');
  return path.join(process.env.GITHUB_WORKSPACE!, file_path);
}

async function getPromnt(): Promise<string> {
  const prompt_file_path: string = getFullFilePath(core.getInput('prompt_file_path'));
  const prompt_file_exists = await access(prompt_file_path)
    .then(() => true)
    .catch(() => false);

  // check that file exists
  if (!prompt_file_exists) {
    throw new Error(`Prompt file ${prompt_file_path} does not exist`);
  }

  // get prompt file content
  let prompt_file_content = await readFile(prompt_file_path, 'utf8');
  core.startGroup('Prompt file content');
  core.debug(prompt_file_content);
  core.endGroup();

  // prompt has templates for file to embed using filepath is brackets
  // get list of file names from the prompt file
  const file_names = prompt_file_content.match(/\{\{(.*?)\}\}/g);

  if (!file_names) return prompt_file_content;
  for (const file_name of file_names) {
    const file_path = getFullFilePath(file_name.replace(/\{\{(.*?)\}\}/g, '$1'));
    const file_exists = await access(file_path)
      .then(() => true)
      .catch(() => false);
    if (!file_exists) {
      core.setFailed(`File ${file_path} does not exist`);
    }
    const file_content = await readFile(file_path, 'utf8');
    core.startGroup(`File ${file_name}`);
    core.debug(file_content);
    core.endGroup();
    prompt_file_content = prompt_file_content.replace(file_name, file_content);
  }
  core.startGroup('Prompt file content after embedding');
  core.debug(prompt_file_content);
  core.endGroup();
  return prompt_file_content;
}

interface GeminiResponse {
  total_score: number;
  feedback: string;
  tasks: Record<string, number>;
}

async function callLLM(prompt: string): Promise<GeminiResponse> {
  core.startGroup('Calling Gemini API');

  const apiKey = core.getInput('gemini_api_key');
  if (!apiKey) throw new Error('Gemini API key is not set');
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash-001',
  });
  const { response } = await model.generateContent({
    generationConfig: {
      temperature: 0,
      topP: 0.95,
      topK: 64,
      maxOutputTokens: 65536,
      candidateCount: 1,
      responseMimeType: 'application/json',
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }],
      },
    ],
  });
  const parsed = JSON.parse(response.text()) as GeminiResponse;
  core.debug(JSON.stringify(parsed, null, 2));
  if (typeof parsed !== 'object') {
    throw new Error('Failed to get valid response from Gemini API');
  }
  if (typeof parsed.total_score !== 'number' || typeof parsed.feedback !== 'string' || typeof parsed.tasks !== 'object') {
    throw new Error('Failed to get valid response from Gemini API');
  }
  // check if all tasks are numbers
  for (const taskName in parsed.tasks) {
    if (typeof parsed.tasks[taskName] !== 'number') {
      throw new Error('Failed to get valid response from Gemini API');
    }
  }
  core.endGroup();
  return parsed;
}

function writeResultToOutput(response: GeminiResponse): void {
  const max_score = Object.keys(response.tasks).length;
  const status = response.total_score / max_score > 0.75 ? 'pass' : 'fail';
  const result = {
    version: 1,
    status,
    max_score,
    tests: [
      {
        score: response.total_score,
        status: response.total_score > 0 ? 'pass' : 'fail',
        message: response.feedback,
      },
    ],
  };
  core.setOutput('result', btoa(JSON.stringify(result)));
}

/**
 * The main function for the action.
 *
 * @returns Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    const prompt = await getPromnt();
    const response = await callLLM(prompt);
    writeResultToOutput(response);
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message);
  }
}
