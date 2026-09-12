package harness
import android.content.Context
import saeon.altino.webctrl.AltinoBle
object AltinoBleFactory { fun make(c: Context, post: (String) -> Unit): AltinoBle = AltinoBle(c, post, {}) }
