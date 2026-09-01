import HeaderContainer from './HeaderContainer';
import HeaderDate from './HeaderDate';
import HeaderLogo, { HeaderBrand } from './HeaderLogo';

const Header = ({
  brand = 'redhat',
  logoSvg,
}: {
  brand?: HeaderBrand;
  logoSvg?: string;
}) => {
  return (
    <HeaderContainer>
      <HeaderLogo brand={brand} logoSvg={logoSvg} />
      <HeaderDate />
    </HeaderContainer>
  );
};

export default Header;
