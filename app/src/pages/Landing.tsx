import NavBar from '../components/landing/NavBar'
import Hero from '../components/landing/Hero'
import HowItWorks from '../components/landing/HowItWorks'
import WhyKassandra from '../components/landing/WhyKassandra'
import TrustPanel from '../components/landing/TrustPanel'
import SiteFooter from '../components/landing/SiteFooter'

/**
 * The Kassandra landing page — composed entirely from the U1 Delphi primitives.
 * Nav → hero constellation → how it works → why → trust portrait → footer, on
 * the parchment canvas at max-width 1200px with ~80px section rhythm.
 */
export default function Landing() {
  return (
    <div className="min-h-screen bg-parchment">
      <NavBar />
      <main>
        <Hero />
        <HowItWorks />
        <WhyKassandra />
        <TrustPanel />
      </main>
      <SiteFooter />
    </div>
  )
}
