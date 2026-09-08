import { DiskLizardRuntime } from "@/pages/disk-utility/runtime"
import DiskUtilityPage from "@/pages/disk-utility"
import { DiskMotionProvider } from "@/pages/disk-utility/motion-ui"
import { ThemeProvider } from "@/components/dl/theme"
import { Toast } from "@/components/dl/toast"
import { diskUtilityFixture, fixtureStorage } from "@/fixture"

function App() {
  return (
    <ThemeProvider>
      <DiskMotionProvider>
        <Toast.Region />
        <DiskLizardRuntime
          platform={{
            platform: "desktop",
            os: "macos",
            diskUtility: diskUtilityFixture,
            windowFullscreen: true,
            storage: fixtureStorage,
          }}
        >
          <DiskUtilityPage />
        </DiskLizardRuntime>
      </DiskMotionProvider>
    </ThemeProvider>
  )
}

export default App
