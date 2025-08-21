export const jsoncParser = (string) => {
    if (typeof string !== 'string') return null;
    try {
        // A robust parser that handles comments inside strings and control characters
        let sanitized = string.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
        sanitized = sanitized.replace(/("(\\.|[^"\\])*"|'(\\.|[^'\\])*')|(\/\*[\s\S]*?\*\/|\/\/(.*))/g, 
            (match, group1) => group1 ? match : ''
        );
        return JSON.parse(sanitized);
    } catch (e) {
        console.error(`Failed to parse JSONC: ${e}`);
        return null;
    }
};
