import ExpoModulesCore

/**
 Where the share extension leaves things.

 A share extension runs in its own container, so the only place it and the app
 can both reach is the App Group container. Nothing in expo-file-system can
 name that directory — its path is assigned by the system and contains a UUID —
 so JavaScript has no way to find it without asking the platform.

 Deliberately just the path. Reading, moving and deleting are left to
 expo-file-system so the behaviour stays in TypeScript, where it can be tested.
 */
public class AppGroupModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AppGroup")

    /// The container path, or nil when the App Group is not provisioned.
    ///
    /// Returning nil rather than throwing is the point: an entitlement that
    /// has not been enabled on the App ID is a configuration state, not an
    /// error, and the app has to keep working without the share extension.
    Function("containerPath") { (identifier: String) -> String? in
      FileManager.default
        .containerURL(forSecurityApplicationGroupIdentifier: identifier)?
        .path
    }
  }
}
