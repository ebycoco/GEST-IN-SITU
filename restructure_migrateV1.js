
const fs = require('fs');

const content = fs.readFileSync('migrateV1_extract.ts', 'utf8');

// The SQL string starts with db.exec(\ and ends with \);
const startRegex = /db\.exec\(\([\s\S]*?)\\);/;
const match = content.match(startRegex);
if (!match) {
    console.error('Could not find db.exec');
    process.exit(1);
}

const sqlRaw = match[1];

// We can split the SQL by statements or just use regex blocks.
// Better: split by ';' but keeping track of statements.
const statements = sqlRaw.split(/(?<=;)\s+/).map(s => s.trim()).filter(s => s.length > 0);

const tables = [];
const virtualTables = [];
const indexes = [];
const triggers = [];
const inserts = [];

for (const stmt of statements) {
    if (stmt.startsWith('--')) {
        // This is a comment only statement or starts with comment
        // Let's attach comments to the next statement by just keeping them intact if we didn't split them.
        // Actually, split might separate comments from statements if there is a ';' in the comment, but there isn't.
    }
    
    if (/^(--[\s\S]*?\n)*CREATE TABLE/i.test(stmt)) {
        tables.push(stmt);
    } else if (/^(--[\s\S]*?\n)*CREATE VIRTUAL TABLE/i.test(stmt)) {
        virtualTables.push(stmt);
    } else if (/^(--[\s\S]*?\n)*CREATE (UNIQUE )?INDEX/i.test(stmt)) {
        indexes.push(stmt);
    } else if (/^(--[\s\S]*?\n)*CREATE TRIGGER/i.test(stmt)) {
        triggers.push(stmt);
    } else if (/^(--[\s\S]*?\n)*INSERT/i.test(stmt)) {
        inserts.push(stmt);
    } else {
        // Fallback for standalone comments or PRAGMAs
        if (stmt.includes('PRAGMA') || stmt.startsWith('--')) {
            // ignore or keep? we can just push to tables if it's not empty and not just comments
            if (stmt.replace(/--.*$/gm, '').trim().length > 0) {
                 tables.push(stmt);
            }
        }
    }
}

const newSql = [
    '    -- =====================================================',
    '    -- 1. TABLES DE BASE',
    '    -- =====================================================',
    ...tables,
    '',
    '    -- =====================================================',
    '    -- 2. TABLES VIRTUELLES (FTS5)',
    '    -- =====================================================',
    ...virtualTables,
    '',
    '    -- =====================================================',
    '    -- 3. INDEXES',
    '    -- =====================================================',
    ...indexes,
    '',
    '    -- =====================================================',
    '    -- 4. TRIGGERS',
    '    -- =====================================================',
    ...triggers,
    '',
    '    -- =====================================================',
    '    -- 5. SEED DATA',
    '    -- =====================================================',
    ...inserts
].join('\\n\\n');

const newContent = content.replace(startRegex, 'db.exec(\\\n' + newSql + '\\n  \);');

const originalTs = fs.readFileSync('src/main/database/schema.ts', 'utf8');
const originalMigrateV1Match = originalTs.match(/(function migrateV1\\(db: Database\\.Database\\): void \\{[\\s\\S]*?\\n\\})/);

if (originalMigrateV1Match) {
    const finalTs = originalTs.replace(originalMigrateV1Match[1], newContent);
    fs.writeFileSync('src/main/database/schema.ts', finalTs);
    console.log('Successfully updated schema.ts');
} else {
    console.error('Could not find migrateV1 in schema.ts');
}

