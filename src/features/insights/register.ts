/**
 * Registers this feature's commands. Called once by the app on startup; returns a cleanup
 * function. (The optimizer service registers `anim.optimize`; insights only links to it.)
 */
import { TriangleAlert, Wrench } from 'lucide-react'
import { registerCommands, type Command } from '@/commands/registry'
import { getDoc } from '@/store/document'
import { fixableCount, fixAllSafe, openIssuesPanel } from './actions'

const hasDoc = () => getDoc() !== null

export function register(): () => void {
  const commands: Command[] = [
    {
      id: 'anim.issues',
      title: (t) => t.insights.commands.issues,
      category: 'animation',
      icon: TriangleAlert,
      keywords: [
        'problems',
        'errors',
        'warnings',
        'compatibility',
        'validate',
        'check',
        'проблемы',
        'ошибки',
        'совместимость',
        'проверка',
      ],
      enabled: hasDoc,
      run: openIssuesPanel,
    },
    {
      id: 'issues.fixAll',
      title: (t) => t.insights.commands.fixAll,
      category: 'animation',
      icon: Wrench,
      keywords: ['repair', 'fix', 'validate', 'исправить', 'починить'],
      enabled: () => hasDoc() && fixableCount() > 0,
      run: () => {
        fixAllSafe()
      },
    },
  ]
  return registerCommands(commands)
}
