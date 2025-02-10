# LLM Based Autograder

This repository provides a GitHub Action that grades student submissions for GitHub Classroom using a Large Language Model (LLM).

## Prompt Configuration

For each execution, configure the LLM prompt by specifying the absolute path to the prompt file. The prompt file can include references to additional files that will be embedded into the prompt. For instance, you can reference a file using the following syntax: `{{./readme.md}}`. Ensure that the file path is absolute and correctly points to the desired resource.
