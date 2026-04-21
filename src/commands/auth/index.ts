import { authLoginCommand } from './login';
import { authLogoutCommand } from './logout';
import { authStatusCommand } from './status';
import { authRefreshCommand } from './refresh';
import { authSignupCommand } from './signup';
import { authWhoamiCommand } from './whoami';

export const authCommands = [
  authLoginCommand,
  authLogoutCommand,
  authStatusCommand,
  authRefreshCommand,
  authSignupCommand,
  authWhoamiCommand,
];
