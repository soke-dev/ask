/**
 * The Confam mark, inlined.
 *
 * The same artwork the app icon is cut from, at the size the page shows it.
 * Embedded rather than served as a file for the reason everything else here
 * is: tsc copies no assets, so a file would work locally and 404 in
 * production. It also cannot arrive late, which matters for the one mark on
 * a page somebody is judging.
 *
 * Drawn as a CSS square with a letter in it before this, which is how two
 * definitions of one logo start to drift — the mistake this project already
 * made once, in the app.
 */
export const LOGO_DATA_URI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEgAAABICAMAAABiM0N1AAAAM1BMVEX/////iTX/+fT/+vf/ZwD/exv//fz/awD/bQP/YwD/8+r/vo//yqT+3cb/m1T/sHb/6diJEc9yAAAACXBIWXMAAAsTAAALEwEAmpwYAAACr0lEQVR42u2Y2ZKsIAyGg4AmrL7/0w5BUbQXYI43p2pSM9XVNP01S/InEZaHDP5AvwNhw7pAaZpq2vIKu4FwIVp003gWfgMhLcJ6M8mvNhlvxUL4EYSKgodO84EUvgehQgcwdxqAw5oEFUd74An8/92Yk/68rkgnSGHiAMz7zK+LgW2mR/UKQnLbp8YG0bBgzTbX0QsIKeyfaeowvf9qOO7u3BpvbIaY7qLDFMU83d9XhCRgW+v7AHj1/+0kQJQlHSDL92C0wr4YTXds+Bv2Bso7q4Y7SNtP+9vWlF55OIyAQt5D8QAoC514y2IEJPi0J/0ONI+AVCeoKUufViRvIFItUQpdIBLeNGzimGuAspd0WQuUnETOu2QU4Tg15NCADtAWAJtc5F3MB+fy2g1KqiL4YF3hAKw2RrvC4Iqczm5AFKZdq4ViHcFgBkBJDYT3OvkUckTwgBUxcAJN12pGVjRNAWsFnZ1zQZVYGwCdgpBjK71fkUqM+LZDlq3NEtyhUDk5yEMhNnHuPSM4lSWPXZ126tyaCauJqlIyky7dnhkI1y6QBJ/yANWSaHUMqpIS3wlyaqlqjjQWkwMtvwLhRRJ9vOQYhabzjPxFLtP3Yi2gmz/0HbZWl+9dkwzmHNl3/XVS4SGvLkvsdci5PqS0IAlS1AMjIRLK6SJx4uOMfmZaHugFGUG5Vl5I+4PMWoCE24zu6I9Y1Ce/l1FRlqcdPBD9q4vRrXAorw9JMIXdwUOaXSt1PhZjzg+aoHBkC66sqwJSSqbIkkfaKftQ/9G8dgOpJdiGufkj6FLWNAvSd0XEu0KrVY++LbSeK/0eK0YfK48fK9gfbCGeamoubVa76fvSZh2N3/yvjd9YKwqfW9HnmuN84iq36w1rtevlAQK2SnVsPkB47pHG34Oo/wL0A1GneF0aBSLhAAAAAElFTkSuQmCC';
