# Architecture

Status: not chosen. Keep it as simple as the demo allows.

## Overview

- Stack:
- Components (3-5 boxes, one line each):
- AI model/provider and why:
- Data storage:
- Deployment: localhost for the video, or a public URL?

## Interface contract

Agree on this before both developers start, so the lanes can work in parallel
(e.g. the UI uses mock responses until the backend is ready). Changing it
needs both developers to agree.

```text
TBD: endpoints or function signatures with example input/output JSON
```

Mock/fixture data lives in: TBD

## Configuration

Environment variable names only (values go in `.env`, never in Git):

- TBD

## Run commands

Exact, tested commands only.

```sh
# install:
# run:
# test:
```

## Demo setup

How to reset and run the demo, plus a fallback if an external service fails.
