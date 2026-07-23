import { issueListCommand } from './list';
import { issueShowCommand } from './show';
import { issueTimelineCommand } from './timeline';
import { issueNoteCommand } from './note';
import { issueMilestoneCommand } from './milestone';

export const issueCommands = [
  issueListCommand,
  issueShowCommand,
  issueTimelineCommand,
  issueNoteCommand,
  issueMilestoneCommand,
];
