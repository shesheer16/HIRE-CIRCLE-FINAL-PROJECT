const { execSync } = require('child_process');
const fs = require('fs');

const categories = {
    'Smart Interview': /(smartInterview|interview)/i,
    'Auth/OTP': /(auth|otp)/i,
    'Socket': /(socket|chat|call|realtime)/i,
    'Match Engine': /(match|recommend)/i,
    'Trust System': /(trust|reputation|abuse|fraud)/i,
    'Rate Limiting': /(rateLimit|abuse|stress|concurrency)/i,
};

function countTests() {
    const result = {};
    for (const cat of Object.keys(categories)) {
        result[cat] = { files: [], count: 0 };
    }

    const filesOut = execSync('find backend/tests -name "*.test.js"').toString().trim();
    const files = filesOut ? filesOut.split('\n') : [];
    for (const file of files) {
        if (!fs.existsSync(file)) continue;
        const content = fs.readFileSync(file, 'utf8');
        const testCount = (content.match(/\s+it\(/g) || []).length + (content.match(/\s+test\(/g) || []).length;

        for (const [cat, regex] of Object.entries(categories)) {
            if (regex.test(file)) {
                result[cat].files.push(file);
                result[cat].count += testCount;
            }
        }
    }
    return result;
}

try {
    const currentBranch = execSync('git rev-parse --abbrev-ref HEAD').toString().trim();

    // Check if working directory is clean before checking out
    execSync('git add . && git stash', { stdio: 'ignore' });

    // Count before (We use HEAD~1 because HEAD is the cleanup commit)
    execSync('git checkout HEAD~1', { stdio: 'ignore' });
    const before = countTests();

    // Count after
    execSync(`git checkout ${currentBranch}`, { stdio: 'ignore' });
    execSync('git stash pop || true', { stdio: 'ignore' });

    const after = countTests();

    const delta = {};
    let restoreNeeded = false;
    const filesToRestore = new Set();

    for (const cat of Object.keys(categories)) {
        const b = before[cat].count;
        const a = after[cat].count;
        const drop = b === 0 ? 0 : ((b - a) / b) * 100;

        delta[cat] = {
            before: b,
            after: a,
            dropPercent: drop
        };

        if (drop > 25) {
            restoreNeeded = true;
            for (const f of before[cat].files) {
                if (!after[cat].files.includes(f)) {
                    filesToRestore.add(f);
                }
            }
        }
    }

    if (restoreNeeded) {
        console.log("Restoring files: ", Array.from(filesToRestore));
        for (const f of filesToRestore) {
            try {
                execSync(`git checkout HEAD~1 -- ${f}`);
            } catch (e) {
                console.error("Failed to restore", f);
            }
        }

        // Update the "after" count again to reflect restored files
        const afterRestoration = countTests();
        for (const cat of Object.keys(categories)) {
            if (delta[cat].dropPercent > 25) {
                delta[cat].after = afterRestoration[cat].count;
                delta[cat].dropPercent = ((delta[cat].before - delta[cat].after) / delta[cat].before) * 100;
            }
        }
    }

    let md = `# Test Coverage Delta Report\n\n`;
    md += `| Module | Tests Before | Tests After | Drop % | Status |\n`;
    md += `|---|---|---|---|---|\n`;

    for (const [cat, data] of Object.entries(delta)) {
        let status = data.dropPercent > 25 ? '⚠️ RESTORED' : '✅ OK';
        if (restoreNeeded && data.dropPercent <= 25) {
            // It could be that it was restored to OK, so let's mark it conditionally
            if (data.before > 0 && ((before[cat].count - after[cat].count) / before[cat].count) * 100 > 25) {
                status = '⚠️ RESTORED';
            }
        }
        md += `| ${cat} | ${data.before} | ${data.after} | ${data.dropPercent.toFixed(2)}% | ${status} |\n`;
    }

    if (restoreNeeded) {
        md += `\n**CRITICAL ACTION TAKEN:** Coverage dropped by > 25% in one or more modules. Restored ${filesToRestore.size} deleted test files from git history.\n`;
        execSync('git add backend/tests/');
        execSync('git commit -m "chore: restored critical test coverage dropped by dead code elimination"');
    } else {
        md += `\nAll critical modules maintained acceptable test coverage (> 75% retained).\n`;
    }

    fs.writeFileSync('/Users/Path/Desktop/Lokesh/HIRE-NEW-V1/TEST_COVERAGE_DELTA_REPORT.md', md);
    console.log(JSON.stringify({ delta, restoreNeeded }, null, 2));

} catch (e) {
    console.error(e.message);
    if (e.stdout) console.error(e.stdout.toString());
    if (e.stderr) console.error(e.stderr.toString());
}
