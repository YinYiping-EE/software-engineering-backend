# Backend instructions

This is the Express + SQLite backend for the calculator assignment at https://bbs.csdn.net/topics/620530837.

- All expression parsing and calculation must occur here. Never execute user input as general-purpose code.
- Database path defaults to `.local/calculator.sqlite` in this repository. Keep user data intact.
- Run `npm ci`, `npm run dev`, `npm test` in this directory when working independently. Runtime is Node.js 24.12 or newer.
- Tests must use isolated databases. Include persistence and error behavior when changing history or calculation logic.
- Follow codestyle.md and update README when API or configuration behavior changes.
