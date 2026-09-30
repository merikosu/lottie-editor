import app from './app'
import assets from './assets'
import code from './code'
import colors from './colors'
import commands from './commands'
import customize from './customize'
import common from './common'
import docops from './docops'
import exportNs from './export'
import home from './home'
import insights from './insights'
import inspector from './inspector'
import io from './io'
import layers from './layers'
import optimizer from './optimizer'
import themes from './themes'
import timeline from './timeline'
import viewport from './viewport'
import workspace from './workspace'

const dict = {
  common,
  app,
  commands,
  io,
  viewport,
  timeline,
  layers,
  inspector,
  colors,
  export: exportNs,
  insights,
  code,
  assets,
  docops,
  workspace,
  home,
  customize,
  optimizer,
  themes,
}

export default dict
