import type { ParsedReviewComment } from '@codraoss/schema';
import type { ReviewOverviewInput } from './ports';

// The third field is OPTIONAL so every comment already on GitHub still parses; requiring it would silently stop recording deletions of historical comments.
const FINDING_MARKER_PATTERN = /<!--\s*codra-fp:([0-9a-f]+):([0-9a-f]*)(?::([0-9a-f]*))?\s*-->/;

// Matching on (path, line) instead would fail exactly when it matters most: GitHub nulls `line` once a comment goes outdated.
export function formatFindingMarker(
  comment: Pick<ParsedReviewComment, 'fingerprint' | 'anchorHash' | 'fingerprintV2'>,
) {
  if (!comment.fingerprint) return '';
  return `\n\n<!-- codra-fp:${comment.fingerprint}:${comment.anchorHash ?? ''}:${comment.fingerprintV2 ?? ''} -->`;
}

export function parseFindingMarker(body: string | null | undefined) {
  if (!body) return null;
  const match = FINDING_MARKER_PATTERN.exec(body);
  if (!match) return null;
  return { fingerprint: match[1], anchorHash: match[2] || null, fingerprintV2: match[3] || null };
}

export class FormatterService {
  constructor(private baseUrl: string) {}

  toReviewEvent(verdict: 'approve' | 'comment') {
    return verdict === 'approve' ? 'APPROVE' as const : 'COMMENT' as const;
  }

  severityIcon(severity: ParsedReviewComment['severity']) {
    const iconBase = `${this.baseUrl}/icons`;
    const img = (name: string, alt: string) =>
      `<img src="${iconBase}/${name}-icon.svg" width="20" height="20" alt="${alt}" style="vertical-align:middle" />`;
    switch (severity) {
      case 'P0':  return img('p0',  'P0');
      case 'P1':  return img('p1',  'P1');
      case 'P2':  return img('p2',  'P2');
      case 'P3':  return img('p3',  'P3');
      case 'nit': return img('nit', 'nit');
      default:    return 'âšª';
    }
  }

  // Mirrors model-output cleanText; keep both in sync.
  stripLeadingTags(text: string): string {
    let current = text.trim();
    let prev = '';
    while (current !== prev) {
      prev = current;
      current = current
        .replace(/^([\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{FE00}-\u{FEFF}]|\[QUALITY\]|\[SECURITY\]|\[BUG\]|\[P[0-3]\]|\[NIT\]|QUALITY|SECURITY|BUG|P[0-3]|NIT|[:\-\s\uFE0F]|[^\w\s])+/giu, '')
        .trim();
    }
    return current;
  }

  formatInlineComment(comment: ParsedReviewComment) {
    // Removes a leading line duplicating the title, which can happen with stale DB records.
    let body = this.stripLeadingTags(comment.body);
    const firstLine = body.split('\n')[0].trim();
    const cleanFirstLine = this.stripLeadingTags(firstLine);
    if (
      cleanFirstLine.toLowerCase().startsWith(comment.title.toLowerCase()) ||
      comment.title.toLowerCase().startsWith(cleanFirstLine.toLowerCase())
    ) {
      body = body.slice(firstLine.length).replace(/^[\n\r]+/, '');
    }

    return `${this.severityIcon(comment.severity)} <strong>${comment.title}</strong>\n\n${body}${formatFindingMarker(comment)}`;
  }

  summarizeVerdict(comments: ParsedReviewComment[], hasFailures: boolean) {
    const p0 = comments.filter((c) => c.severity === 'P0').length;
    const p1 = comments.filter((c) => c.severity === 'P1').length;
    const p2 = comments.filter((c) => c.severity === 'P2').length;

    if (p0 > 0 || p1 > 0 || hasFailures || p2 > 0) {
      return { verdict: 'comment' as const, errors: p0 + p1, warnings: p2 };
    }

    return { verdict: 'approve' as const, errors: 0, warnings: 0 };
  }

  formatReviewOverview(input: ReviewOverviewInput) {
    const { commitSha, postedFindings, filesReviewed, linesReviewed } = input;
    const shortSha = commitSha.slice(0, 10);
    const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

    // A clean review used to say "here are some automated review suggestions" and then list none,
    // which reads as a failure rather than a pass. Say what was checked and that nothing came of it.
    // With findings the original wording stays.
    const headline = postedFindings === 0
      ? `âœ… **Nothing to flag.** Reviewed ${plural(filesReviewed, 'file')} (${plural(linesReviewed, 'changed line')}) and found no issues worth raising.`
      : 'Here are some automated review suggestions for this pull request.';

    const notes: string[] = [];
    if (input.filesFailed > 0) {
      notes.push(`${plural(input.filesFailed, 'file')} could not be reviewed, so this pass is incomplete.`);
    }
    if (postedFindings === 0 && input.withheldFindings > 0) {
      // "No issues" is a weaker claim when candidates were dropped for failing to ground themselves,
      // and every one of them is on the dashboard.
      notes.push(`${plural(input.withheldFindings, 'candidate')} did not survive the evidence and claim gates â€” see the [dashboard](${this.baseUrl}) for what was dropped and why.`);
    }
    
    const noteBlock = notes.length > 0
      ? '\n' + notes.map((line) => `> [!NOTE]\n> ${line}`).join('\n\n') + '\n'
      : '';

    const aboutOutcome = postedFindings === 0
      ? 'Every review posts a summary here. A clean pass also gets a ðŸ‘ on the pull request itself.'
      : 'If Codra has suggestions, it will comment; otherwise it will react with ðŸ‘.';

    return `### Codra Review

${headline}
${noteBlock}
**Reviewed commit:** \`${shortSha}\`

<details>
<summary>â„¹ï¸ About Codra in GitHub</summary>

<br/>

[Your team has set up Codra to review pull requests in this repo](${this.baseUrl}/repos). Reviews are triggered when you:

- **Open** a pull request for review
- **Mark** a draft as ready

${aboutOutcome}

</details>`;
  }
}

