import { useState } from 'react'
import { SimulatorGroupList, type SimulatorGroup } from '@/components/simulator/SimulatorGroupList'
import { SimulatorChat } from '@/components/simulator/SimulatorChat'
import { MessageSquare } from 'lucide-react'

export function SimulatorPage() {
  const [selectedGroup, setSelectedGroup] = useState<SimulatorGroup | null>(null)

  return (
    <div className="h-[calc(100vh-4rem)] -m-8 flex">
      {/* Left panel: Group list */}
      <div className="w-72 border-r border-border bg-card/30 flex flex-col shrink-0">
        <div className="px-4 py-3 border-b border-border">
          <h1 className="text-sm font-semibold flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-primary" />
            Message Simulator
          </h1>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Test messages through the real bot pipeline
          </p>
        </div>
        <div className="flex-1 overflow-y-auto">
          <SimulatorGroupList
            selectedGroupJid={selectedGroup?.groupJid || null}
            onSelectGroup={setSelectedGroup}
          />
        </div>
      </div>

      {/* Right panel: Chat */}
      <div className="flex-1 flex flex-col min-w-0">
        {selectedGroup ? (
          <SimulatorChat key={selectedGroup.groupJid} group={selectedGroup} />
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Select a group to start simulating</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
