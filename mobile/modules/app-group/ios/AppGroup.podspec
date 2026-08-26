Pod::Spec.new do |s|
  s.name           = 'AppGroup'
  s.version        = '1.0.0'
  s.summary        = 'Resolves the shared App Group container path for JavaScript.'
  s.description    = 'The share extension writes into an App Group container. Nothing in expo-file-system can name that directory, so this exposes its path.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.license        = { :type => 'MIT' }
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
