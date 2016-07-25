<?php 
$script = $_POST['script'];
$source = $_POST['source'];
$x = $_POST['x'];
$y = $_POST['y'];

$command = escapeshellcmd('python ' . $script . ' ' . $source . ' ' . $x . ' ' . $y);
$output = shell_exec($command);
echo $output;

?>
