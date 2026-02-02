import { Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from './components/shared/Layout'
import { OverviewPage } from './pages/OverviewPage'
import { GroupsAndRulesPage } from './pages/GroupsAndRulesPage'
import { PatternsPage } from './pages/PatternsPage'
import { CostsPage } from './pages/CostsPage'

function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/overview" replace />} />
        <Route path="/overview" element={<OverviewPage />} />
        <Route path="/groups" element={<GroupsAndRulesPage />} />
        <Route path="/patterns" element={<PatternsPage />} />
        <Route path="/costs" element={<CostsPage />} />
        {/* Legacy redirects */}
        <Route path="/rules" element={<Navigate to="/groups" replace />} />
      </Routes>
    </Layout>
  )
}

export default App
