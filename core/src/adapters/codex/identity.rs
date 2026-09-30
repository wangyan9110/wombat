//! Narrow, read-only migration of established local identities. Never modify the old registry.
use super::*;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Registry {
    version: u32,
    environment_id: String,
    objects: BTreeMap<String, String>,
    files: BTreeMap<String, FileState>,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileState {
    size: u64,
    content_hash: String,
    generation: String,
}
pub(super) struct LegacyFile {
    pub size: u64,
    pub content_hash: String,
    generation: String,
    environment: String,
}
impl LegacyFile {
    pub fn thread_id(&self, upstream: &str) -> String {
        format!(
            "ses_{:x}",
            Sha256::digest(format!(
                "{}:{}:codex:{}",
                self.environment, self.generation, upstream
            ))
        )
    }
}
fn physical(path: &Path) -> Option<String> {
    let metadata = fs::metadata(path).ok()?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        Some(format!(
            "{}:{}:{:?}",
            metadata.dev(),
            metadata.ino(),
            metadata.created().ok()
        ))
    }
    #[cfg(not(unix))]
    {
        Some(format!(
            "{}:{:?}",
            fs::canonicalize(path).ok()?.to_string_lossy(),
            metadata.created().ok()
        ))
    }
}
pub(super) fn read_registry() -> Option<Registry> {
    let root = crate::storage::data_home().ok()?;
    let file = File::open(root.join("identity-v1.json")).ok()?;
    if file.metadata().ok()?.len() > 32 * 1024 * 1024 {
        return None;
    }
    let registry: Registry = serde_json::from_reader(BufReader::new(file)).ok()?;
    (registry.version == 1).then_some(registry)
}
impl Registry {
    pub fn source(&self, root: &Path) -> Option<String> {
        self.objects
            .get(&format!("inst:codex:{}", physical(root)?))
            .cloned()
    }
    pub fn file(&self, path: &Path) -> Option<LegacyFile> {
        let file = self.files.get(&physical(path)?)?;
        Some(LegacyFile {
            size: file.size,
            content_hash: file.content_hash.clone(),
            generation: file.generation.clone(),
            environment: self.environment_id.clone(),
        })
    }
}
