import { NextResponse } from 'next/server';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { paths } from '../../../../../src/config.js';
import { ingestCompanyList } from '../../../../../src/ingest/companyLists.js';
import { ingestConnections } from '../../../../../src/ingest/connections.js';
import { sameOrigin } from '@/lib/guard';

/**
 * Accept the files the tool needs, so setup does not require a terminal.
 *
 * The file is written into data/input first and then ingested from disk, rather
 * than parsed from memory: that directory is gitignored, it is where the CLI
 * looks, and keeping one copy means a re-run of `npm run ingest` behaves
 * identically to the upload.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MAX_BYTES = 25 * 1024 * 1024;

export async function POST(req: Request) {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: 'Cross-origin upload refused' }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Expected a file upload' }, { status: 400 });
  }

  const file = form.get('file');
  const kind = String(form.get('kind') ?? '');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file received' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `That file is larger than ${MAX_BYTES / 1024 / 1024}MB` }, { status: 413 });
  }

  // The name is user-supplied, so only its basename is ever used.
  const safeName = file.name.replace(/[/\\]/g, '_').slice(0, 120) || 'upload';
  const bytes = Buffer.from(await file.arrayBuffer());

  try {
    mkdirSync(paths.inputDir, { recursive: true });

    if (kind === 'company-list') {
      if (!/\.csv$/i.test(safeName)) {
        return NextResponse.json({ error: 'A company list must be a .csv export' }, { status: 400 });
      }
      const dest = resolve(paths.inputDir, safeName);
      writeFileSync(dest, bytes);
      const listName = String(form.get('name') ?? '').trim() || undefined;
      const r = ingestCompanyList(dest, listName);
      return NextResponse.json({
        kind,
        summary: `${r.list}: ${r.companiesInFile} rows, ${r.newCompanies} new companies`,
        detail: r,
      });
    }

    if (kind === 'connections') {
      if (!/\.csv$/i.test(safeName)) {
        return NextResponse.json({ error: 'Connections must be the .csv LinkedIn exports' }, { status: 400 });
      }
      writeFileSync(paths.connectionsCsv, bytes);
      const r = ingestConnections(paths.connectionsCsv);
      return NextResponse.json({
        kind,
        summary: `${r.inserted} new connections imported (${r.total} total)`,
        detail: r,
      });
    }


    return NextResponse.json({ error: `Unknown upload kind "${kind}"` }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[setup/upload] failed:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
