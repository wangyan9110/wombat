//! Deliberately limited POSIX command forms; never expand variables or invoke an interpreter.
use std::path::Path;
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Script {
    pub path: String,
    pub node_entry: bool,
}
pub(super) fn script(command: &str) -> Option<Script> {
    if command.len() > 16_384
        || command
            .chars()
            .any(|c| c.is_control() || "$`;|&<>()*?[]{}~#".contains(c))
    {
        return None;
    }
    let words = shlex::split(command)?;
    if words.is_empty() || words.len() > 128 {
        return None;
    }
    let program = Path::new(&words[0]).file_name()?.to_str()?;
    let python = matches!(program, "python" | "python2" | "python3")
        || program
            .strip_prefix("python3.")
            .is_some_and(|v| !v.is_empty() && v.bytes().all(|b| b.is_ascii_digit()));
    let shell = matches!(program, "sh" | "bash" | "dash" | "zsh");
    let node = matches!(program, "node" | "nodejs");
    let target = if python || shell || node {
        let mut position = 1;
        while let Some(option) = words.get(position).filter(|v| v.starts_with('-')) {
            position += 1;
            if option == "--" {
                break;
            }
            let allowed = if python {
                matches!(
                    option.as_str(),
                    "-B" | "-E" | "-I" | "-s" | "-S" | "-u" | "-q"
                )
            } else if shell {
                matches!(option.as_str(), "-e" | "-u" | "-x" | "-v" | "-n")
            } else {
                false
            };
            if !allowed {
                return None;
            }
        }
        let path = words.get(position)?;
        // Shell script lookup may search PATH unless the script includes a slash.
        if shell && !path.contains('/') {
            return None;
        }
        path
    } else {
        // Explicit executable script path; no PATH lookup or shebang inference.
        let path = &words[0];
        if !(path.starts_with('/') || path.starts_with("./") || path.starts_with("../"))
            || !matches!(
                Path::new(path).extension().and_then(|e| e.to_str()),
                Some("sh" | "py" | "js" | "mjs" | "cjs")
            )
        {
            return None;
        }
        path
    };
    if target.is_empty() || target.starts_with('-') || target.len() > 4096 {
        return None;
    }
    Some(Script {
        path: target.clone(),
        node_entry: node,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn static_interpreters_preserve_quoted_unicode_spaces_and_escape_boundaries() {
        for (command, path) in [
            (
                "python3 -I -B -- '工具 脚本.py' --arg value",
                "工具 脚本.py",
            ),
            ("/usr/bin/python3.13 ../task.py", "../task.py"),
            ("bash -e './tools/my script.sh'", "./tools/my script.sh"),
            ("node ./my\\ script.mjs", "./my script.mjs"),
            ("'./run hook.sh' literal", "./run hook.sh"),
        ] {
            assert_eq!(script(command).unwrap().path, path);
        }
        assert!(script("node ./file.js").unwrap().node_entry);
    }
    #[test]
    fn dynamic_inline_module_path_search_and_unknown_flags_are_not_missing_scripts() {
        for command in [
            "python3 -c 'run()'",
            "python3 -m missing",
            "python3 -",
            "node -e example",
            "node --import loader task.js",
            "python3 $FILE",
            "python3 '${FILE}'",
            "python3 `get`",
            "python3 task.py | cat",
            "python3 task.py; other",
            "python3 *.py",
            "python3 task.py # note",
            "python3 task.py\nother",
            "env python3 task.py",
            "X=1 python3 task.py",
            "bash script.sh",
            "bash -c ./script.sh",
            "python3 'unclosed",
            "unknown script.py",
            "node",
            "./binary",
            "python3 -X flag task.py",
        ] {
            assert!(script(command).is_none(), "{command}");
        }
    }
}
