import { Construction } from 'lucide-react'
import { EmptyState } from '@/components/ui'

/** Temporary placeholder used while a feature is being built. */
export function FeatureStub({ name }: { name: string }) {
  return <EmptyState icon={Construction} title={name} description="Coming soon" />
}
